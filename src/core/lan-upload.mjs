// 局域网直传接收器（手机 App → 电脑），协议见 docs/lan-upload-protocol.md
//
// 纯 Node 模块（不依赖 Electron），方便 scripts/check-lan-upload.mjs 直接测试：
//   - HTTP：GET /health 探活，POST /upload 接收 ZIP
//   - UDP：周期性向 255.255.255.255:8738 广播 {"app":"samsung-health-viz","protocol":1,"httpPort":N}
// 安全边界：仅在局域网使用；6 位令牌只用于防误传，不承担强认证。
import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { finished } from 'node:stream/promises';

export const APP_ID = 'samsung-health-viz';
export const PROTOCOL = 1;
export const DEFAULT_PORT = 8737;
export const PORT_RANGE = 10;
export const DISCOVERY_PORT = 8738;
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2 GiB
export const MAX_FAILED_ATTEMPTS = 10; // 同一 IP 每分钟最多失败次数
export const MAX_NAME_LEN = 80;

/** 6 位数字令牌（桌面端每次启动重新生成，只存内存） */
export function generateToken() {
  return String(crypto.randomInt(100000, 1000000));
}

/** 本机可用于局域网访问的 IPv4 地址（排除回环、链路本地） */
export function listLanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/** 计算各网卡的定向广播地址，用于 UDP 发现（全局广播在部分路由器上会被丢弃） */
function listBroadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const { address, netmask } of listLanAddresses()) {
    try {
      const ip = address.split('.').reduce((s, n) => (s << 8) + Number(n), 0) >>> 0;
      const mask = netmask.split('.').reduce((s, n) => (s << 8) + Number(n), 0) >>> 0;
      const b = (ip | (~mask >>> 0)) >>> 0;
      out.add([24, 16, 8, 0].map((s) => (b >>> s) & 255).join('.'));
    } catch {
      /* 忽略异常网卡 */
    }
  }
  return [...out];
}

/** 文件名白名单清洗：防目录穿越、控制字符、非 ASCII 路径；强制 .zip 后缀 */
export function sanitizeFileName(raw, fallback = 'samsung-health-export.zip') {
  let name = '';
  try {
    name = decodeURIComponent(String(raw || ''));
  } catch {
    name = String(raw || '');
  }
  name = path.basename(name.replace(/\\/g, '/'));
  name = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '');
  if (!name) name = fallback;
  if (!/\.zip$/i.test(name)) name += '.zip';
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN - 4) + '.zip';
  return name;
}

function tokenEquals(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 启动接收器。
 * @param {object} opts
 * @param {string} opts.uploadDir 上传保存目录（不存在会自动创建）
 * @param {number} [opts.port=8737] 起始端口；被占用时向后顺延 PORT_RANGE 个
 * @param {string} [opts.token] 6 位令牌；不传则随机生成
 * @param {number} [opts.maxBytes] 单次上传上限
 * @param {boolean} [opts.beacon=true] 是否发 UDP 发现广播
 * @param {'zh'|'en'} [opts.locale='zh'] 事件里用户可见文案的语言
 * @param {(event: object) => void} [opts.onEvent] 事件回调
 * @returns {Promise<{info: Function, stop: Function, regenerateToken: Function}>}
 */
export async function startLanReceiver(opts = {}) {
  const {
    uploadDir,
    port = DEFAULT_PORT,
    token = generateToken(),
    maxBytes = MAX_UPLOAD_BYTES,
    beacon = true,
    locale = 'zh',
    onEvent = () => {},
  } = opts;

  // 事件里的用户可见文案（错误信息等）按 locale 输出；协议里的错误码保持英文 token
  const msg = (zh, en) => (locale === 'en' ? en : zh);

  if (!uploadDir) throw new Error(msg('缺少上传目录参数', 'uploadDir is required'));
  fs.mkdirSync(uploadDir, { recursive: true });
  // 清理上次异常退出留下的半成品
  for (const f of fs.readdirSync(uploadDir)) {
    if (f.endsWith('.part')) fs.rmSync(path.join(uploadDir, f), { force: true });
  }

  const state = {
    port: 0,
    token,
    busy: false,
    stopped: false,
    lastUpload: null,
    failures: new Map(), // ip -> { count, resetAt }
  };

  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      /* 回调错误不能影响接收流程 */
    }
  };

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      emit({ type: 'error', message: String(err?.message || err) });
      if (!res.headersSent) json(res, 500, { ok: false, error: 'internal' });
      else res.destroy();
    });
  });
  // 大文件上传中不要被默认超时掐断
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 30_000;

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, app: APP_ID, protocol: PROTOCOL });
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      return handleUpload(req, res);
    }
    return json(res, 404, { ok: false, error: 'not-found' });
  }

  function clientIp(req) {
    const raw = String(req.socket.remoteAddress || '');
    return raw.replace(/^::ffff:/, '');
  }

  function rateLimited(ip) {
    const now = Date.now();
    const rec = state.failures.get(ip);
    if (!rec || now > rec.resetAt) return false;
    return rec.count >= MAX_FAILED_ATTEMPTS;
  }

  function noteFailure(ip) {
    const now = Date.now();
    const rec = state.failures.get(ip);
    if (!rec || now > rec.resetAt) state.failures.set(ip, { count: 1, resetAt: now + 60_000 });
    else rec.count += 1;
  }

  async function handleUpload(req, res) {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      req.resume();
      emit({ type: 'upload-rejected', reason: 'too-many-attempts', ip });
      return json(res, 429, { ok: false, error: 'too-many-attempts' });
    }
    if (!tokenEquals(req.headers['x-upload-token'], state.token)) {
      noteFailure(ip);
      req.resume();
      emit({ type: 'upload-rejected', reason: 'bad-token', ip });
      return json(res, 401, { ok: false, error: 'bad-token' });
    }
    if (state.busy) {
      req.resume();
      emit({ type: 'upload-rejected', reason: 'busy', ip });
      return json(res, 409, { ok: false, error: 'busy' });
    }

    // 固定长度上传：可以先拒掉明显超限的请求（chunked 时没有该头，边收边判）
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.resume();
      emit({ type: 'upload-rejected', reason: 'too-large', ip, bytes: declaredLength });
      return json(res, 413, { ok: false, error: 'too-large' });
    }

    const expectedSha = String(req.headers['x-file-sha256'] || '').trim().toLowerCase();
    if (expectedSha && !/^[0-9a-f]{64}$/.test(expectedSha)) {
      req.resume();
      return json(res, 400, { ok: false, error: 'bad-checksum' });
    }

    const fallback = `samsung-health-export-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.zip`;
    const name = sanitizeFileName(req.headers['x-file-name'], fallback);
    const finalPath = path.join(uploadDir, name);
    const partPath = `${finalPath}.part`;
    const startedAt = Date.now();

    state.busy = true;
    emit({ type: 'upload-start', name, ip });

    let bytes = 0;
    let tooLarge = false;
    let aborted = false;
    let lastEmit = 0;
    const digest = crypto.createHash('sha256');
    const ws = fs.createWriteStream(partPath, { flags: 'w' });

    const cleanup = () => {
      state.busy = false;
      fs.rmSync(partPath, { force: true });
    };

    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          tooLarge = true;
          break;
        }
        digest.update(chunk);
        if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
        const now = Date.now();
        if (now - lastEmit > 300) {
          lastEmit = now;
          emit({ type: 'upload-progress', bytes });
        }
      }
      if (tooLarge) {
        ws.destroy();
        cleanup();
        emit({ type: 'upload-rejected', reason: 'too-large', ip, bytes });
        return json(res, 413, { ok: false, error: 'too-large' });
      }
      ws.end();
      await finished(ws);
    } catch (err) {
      aborted = true;
      ws.destroy();
      cleanup();
      emit({
        type: 'error',
        message: msg(`接收中断：${err?.message || err}`, `Upload interrupted: ${err?.message || err}`),
      });
      if (!res.headersSent) json(res, 500, { ok: false, error: 'aborted' });
      return;
    }

    if (aborted) return;

    // 简单校验 ZIP 魔数，避免把任意文件写进缓存目录
    let magicOk = false;
    try {
      const fd = fs.openSync(partPath, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      magicOk = buf[0] === 0x50 && buf[1] === 0x4b;
    } catch {
      magicOk = false;
    }
    if (!magicOk) {
      cleanup();
      emit({ type: 'upload-rejected', reason: 'bad-file', ip, bytes });
      return json(res, 400, { ok: false, error: 'bad-file' });
    }

    // 长度/SHA-256 校验（App 端固定长度上传时都会带；旧版 chunked 上传不带 SHA-256 时跳过）
    if (Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength !== bytes) {
      cleanup();
      emit({ type: 'upload-rejected', reason: 'size-mismatch', ip, bytes });
      return json(res, 400, { ok: false, error: 'size-mismatch' });
    }
    if (expectedSha) {
      const actualSha = digest.digest('hex');
      if (actualSha !== expectedSha) {
        cleanup();
        emit({ type: 'upload-rejected', reason: 'checksum-mismatch', ip, bytes });
        return json(res, 400, { ok: false, error: 'checksum-mismatch' });
      }
    }

    try {
      fs.rmSync(finalPath, { force: true });
      fs.renameSync(partPath, finalPath);
    } catch (err) {
      cleanup();
      emit({ type: 'error', message: msg(`保存失败：${err?.message || err}`, `Failed to save upload: ${err?.message || err}`) });
      return json(res, 500, { ok: false, error: 'save-failed' });
    }

    const receiveMs = Date.now() - startedAt;
    state.busy = false;
    state.lastUpload = { name, bytes, at: Date.now(), path: finalPath, receiveMs };
    emit({ type: 'upload-saved', name, bytes, path: finalPath, receiveMs });
    return json(res, 200, { ok: true, file: name, bytes, ms: receiveMs });
  }

  // 端口被占用时向后顺延，避免用户设备上常见的 8737 冲突
  const listen = (p) =>
    new Promise((resolve, reject) => {
      const onError = (err) => {
        httpServer.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.removeListener('error', onError);
        resolve();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(p, '0.0.0.0');
    });

  let lastErr = null;
  for (let i = 0; i < PORT_RANGE; i++) {
    const candidate = port === 0 ? 0 : port + i;
    try {
      await listen(candidate);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EADDRINUSE') break;
      await sleep(60);
    }
  }
  if (lastErr) {
    httpServer.close();
    throw lastErr;
  }
  state.port = httpServer.address().port;

  // UDP 广播：手机 App 靠它自动发现电脑（拿包来源地址，避免信任包内 IP）
  let beaconTimer = null;
  let udp = null;
  const payload = () => Buffer.from(
    JSON.stringify({ app: APP_ID, protocol: PROTOCOL, httpPort: state.port, name: os.hostname() })
  );
  const sendBeacon = () => {
    if (!udp || state.stopped) return;
    for (const addr of listBroadcastAddresses()) {
      try {
        udp.send(payload(), DISCOVERY_PORT, addr, () => {});
      } catch {
        /* 某些网卡不允许广播，忽略 */
      }
    }
  };
  if (beacon) {
    try {
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('error', () => {});
      udp.bind(() => {
        try {
          udp.setBroadcast(true);
        } catch {
          /* ignore */
        }
        sendBeacon();
      });
      beaconTimer = setInterval(sendBeacon, 3000);
      beaconTimer.unref?.();
      udp.unref?.();
    } catch {
      udp = null;
    }
  }

  const info = () => ({
    running: !state.stopped,
    port: state.port,
    token: state.token,
    urls: listLanAddresses().map((a) => `http://${a.address}:${state.port}`),
    uploadDir,
    busy: state.busy,
    lastUpload: state.lastUpload,
  });

  emit({ type: 'listening', ...info() });

  const stop = async () => {
    if (state.stopped) return;
    state.stopped = true;
    if (beaconTimer) clearInterval(beaconTimer);
    try {
      udp?.close();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => httpServer.close(() => resolve()));
    emit({ type: 'stopped' });
  };

  const regenerateToken = () => {
    state.token = generateToken();
    emit({ type: 'token', token: state.token });
    return state.token;
  };

  return { info, stop, regenerateToken };
}
