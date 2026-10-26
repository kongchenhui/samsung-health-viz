// 局域网直传接收器自检（不依赖 Electron / 真机）：
//   生成一个「伪造的三星健康导出目录」→ 打包 ZIP → 走真实 HTTP 上传 → 再用真实解析器解析
// 用法：node scripts/check-lan-upload.mjs
// 说明：测试数据全部是虚构值（坐标、心率、时间均为随便编的），不包含任何真实用户数据。
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { startLanReceiver } from '../src/core/lan-upload.mjs';
import { zipReader, buildCyclingDataset } from '../src/core/parse.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-lan-'));
const ROOT_NAME = 'samsunghealth_00000000000_20260101000000'; // 占位账号，非真实号码
const UPLOADS = path.join(TMP, 'uploads');
const TOKEN = '123456';
const START_MS = Date.UTC(2026, 0, 1, 2, 0, 0);

let passed = 0;
let failed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}
function bad(name, err) {
  failed++;
  console.error(`  ✗ ${name}`);
  console.error(`    ${err?.message || err}`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e);
  }
}

/* ---------------- 伪造导出包 ---------------- */
function makeExportFolder() {
  const dir = path.join(TMP, ROOT_NAME);
  const jsonDir = path.join(dir, 'jsons', 'com.samsung.shealth.exercise', 'U');
  fs.mkdirSync(jsonDir, { recursive: true });

  const header = [
    'com.samsung.shealth.exercise.datauuid',
    'com.samsung.shealth.exercise.exercise_type',
    'com.samsung.shealth.exercise.start_time',
    'com.samsung.shealth.exercise.end_time',
    'com.samsung.shealth.exercise.duration',
    'com.samsung.shealth.exercise.distance',
    'com.samsung.shealth.exercise.calorie',
    'com.samsung.shealth.exercise.mean_heart_rate',
    'com.samsung.shealth.exercise.max_heart_rate',
    'com.samsung.shealth.exercise.min_heart_rate',
    'com.samsung.shealth.exercise.altitude_gain',
    'com.samsung.shealth.exercise.altitude_loss',
    'com.samsung.shealth.exercise.deviceuuid',
    'com.samsung.shealth.exercise.location_data',
    'com.samsung.shealth.exercise.live_data',
  ];
  const uuid = 'UNIT-TEST-RIDE-1';
  const row = [
    uuid,
    '11007',
    '2026-01-01 02:00:00.000',
    '2026-01-01 02:30:00.000',
    '1800000',
    '8000',
    '200',
    '130',
    '160',
    '90',
    '50',
    '40',
    'UNIT-TEST-DEVICE',
    `${uuid}.location_data.json`,
    `${uuid}.live_data.json`,
    '', // 三星导出每行末尾多一个空字段
  ];
  fs.writeFileSync(
    path.join(dir, 'com.samsung.shealth.exercise.0.csv'),
    `com.samsung.shealth.exercise,1.0\n${header.join(',')}\n${row.join(',')}\n`,
    'utf8'
  );

  const loc = [];
  const live = [];
  for (let i = 0; i <= 6; i++) {
    const t = START_MS + i * 10_000;
    loc.push({ latitude: 0.5 + i * 0.0002, longitude: 0.5 + i * 0.0001, altitude: 10 + i, start_time: t, accuracy: 5 });
    live.push({ start_time: t, speed: 5 + i * 0.1, heart_rate: 120 + i, distance: 20, calorie: 1.2 });
  }
  fs.writeFileSync(path.join(jsonDir, `${uuid}.location_data.json`), JSON.stringify(loc));
  fs.writeFileSync(path.join(jsonDir, `${uuid}.live_data.json`), JSON.stringify(live));
  return dir;
}

function zipOf(folder) {
  const zip = new AdmZip();
  zip.addLocalFolder(folder, ROOT_NAME);
  return zip.toBuffer();
}

/* ---------------- HTTP 小工具 ---------------- */
function request(port, { method = 'GET', path: p = '/', headers = {}, body = null, chunked = true, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: p, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* 非 JSON 响应 */
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on('error', reject);
    if (!body) return req.end();
    if (chunked) {
      let off = 0;
      const step = 64 * 1024;
      const pump = () => {
        while (off < body.length) {
          const chunk = body.subarray(off, off + step);
          off += chunk.length;
          const more = req.write(chunk);
          onProgress?.(off);
          if (!more) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    } else {
      req.end(body);
    }
  });
}

/* ---------------- 用例 ---------------- */
const folder = makeExportFolder();
const zipBuf = zipOf(folder);
const events = [];
let receiver = null;

try {
  receiver = await startLanReceiver({
    uploadDir: UPLOADS,
    port: 0,
    token: TOKEN,
    beacon: false,
    onEvent: (ev) => events.push(ev),
  });
  const port = receiver.info().port;

  await test('/health 探活', async () => {
    const res = await request(port, { path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.json.app, 'samsung-health-viz');
    assert.equal(res.json.protocol, 1);
  });

  await test('未知路径返回 404', async () => {
    const res = await request(port, { path: '/nope' });
    assert.equal(res.status, 404);
  });

  await test('令牌错误返回 401', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: { 'x-upload-token': '000000', 'x-file-name': 'a.zip' },
      body: zipBuf,
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'bad-token');
  });

  await test('令牌错误不会留下文件', async () => {
    const list = fs.readdirSync(UPLOADS);
    assert.deepEqual(list, []);
  });

  let uploadProgressBytes = 0;
  await test('正确令牌 + chunked 上传 ZIP 成功', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: {
        'x-upload-token': TOKEN,
        'x-file-name': encodeURIComponent(`${ROOT_NAME}.zip`),
        'content-type': 'application/zip',
      },
      body: zipBuf,
      onProgress: (n) => (uploadProgressBytes = n),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.bytes, zipBuf.length);
    assert.ok(uploadProgressBytes > 0);
  });

  const savedName = `${ROOT_NAME}.zip`;
  const savedPath = path.join(UPLOADS, savedName);

  await test('文件按清洗后的名字落盘', () => {
    assert.ok(fs.existsSync(savedPath), '文件不存在：' + savedName);
    assert.equal(fs.statSync(savedPath).size, zipBuf.length);
  });

  await test('事件流包含 start/progress/saved', () => {
    const types = events.map((e) => e.type);
    assert.ok(types.includes('listening'), '缺少 listening');
    assert.ok(types.includes('upload-start'), '缺少 upload-start');
    assert.ok(types.includes('upload-progress'), '缺少 upload-progress');
    assert.ok(types.includes('upload-saved'), '缺少 upload-saved');
  });

  await test('ZIP 内保留顶层目录（解析器依赖）', () => {
    const names = new AdmZip(savedPath).getEntries().map((e) => e.entryName);
    assert.ok(names.length > 0);
    assert.ok(
      names.every((n) => n.startsWith(ROOT_NAME + '/')),
      '存在没有顶层目录的条目：' + names.filter((n) => !n.startsWith(ROOT_NAME + '/')).slice(0, 3).join(', ')
    );
  });

  await test('真实解析器能解析上传的 ZIP（1 条骑行 + 轨迹）', () => {
    const data = buildCyclingDataset(zipReader(savedPath));
    assert.equal(data.rides.length, 1);
    const ride = data.rides[0];
    assert.equal(ride.hasTrack, true);
    assert.ok(ride.track.lat.length >= 2);
    assert.equal(ride.distanceM, 8000);
  });

  await test('文件名清洗（目录穿越 / 非法字符 / 缺后缀）', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: {
        'x-upload-token': TOKEN,
        'x-file-name': encodeURIComponent('../../evil name?.zip'),
        'content-type': 'application/zip',
      },
      body: zipBuf,
    });
    assert.equal(res.status, 200);
    const files = fs.readdirSync(UPLOADS);
    const found = files.find((f) => f.startsWith('evil_name'));
    assert.ok(found, '清洗后的文件不存在，实际：' + files.join(', '));
    assert.ok(!found.includes('/') && !found.includes('..'));
    assert.ok(found.endsWith('.zip'));
    fs.rmSync(path.join(UPLOADS, found), { force: true });
  });

  await test('固定长度 + SHA-256 上传成功', async () => {
    const buf = zipBuf;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: {
        'x-upload-token': TOKEN,
        'x-file-name': 'checksum-ok.zip',
        'x-file-sha256': sha,
        'content-type': 'application/zip',
      },
      body: buf,
      chunked: false, // 让 Node 自动带 Content-Length
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.bytes, buf.length);
    assert.ok(res.json.ms >= 0);
    assert.ok(fs.existsSync(path.join(UPLOADS, 'checksum-ok.zip')));
    fs.rmSync(path.join(UPLOADS, 'checksum-ok.zip'), { force: true });
  });

  await test('SHA-256 不匹配返回 400 且不落盘', async () => {
    const badSha = '0'.repeat(64);
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: {
        'x-upload-token': TOKEN,
        'x-file-name': 'checksum-bad.zip',
        'x-file-sha256': badSha,
        'content-type': 'application/zip',
      },
      body: zipBuf,
      chunked: false,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'checksum-mismatch');
    assert.ok(!fs.existsSync(path.join(UPLOADS, 'checksum-bad.zip')));
  });

  await test('非 ZIP 内容返回 400 且不落盘', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/upload',
      headers: { 'x-upload-token': TOKEN, 'x-file-name': 'notzip.zip' },
      body: Buffer.from('hello, not a zip file'),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'bad-file');
    assert.ok(!fs.existsSync(path.join(UPLOADS, 'notzip.zip')));
  });

  await test('超过上限返回 413 且不落盘', async () => {
    const small = await startLanReceiver({
      uploadDir: path.join(TMP, 'uploads-small'),
      port: 0,
      token: TOKEN,
      maxBytes: 1024,
      beacon: false,
    });
    try {
      const res = await request(small.info().port, {
        method: 'POST',
        path: '/upload',
        headers: { 'x-upload-token': TOKEN, 'x-file-name': 'big.zip' },
        body: zipBuf,
      });
      assert.equal(res.status, 413);
      const dir = path.join(TMP, 'uploads-small');
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      await small.stop();
    }
  });
} finally {
  await receiver?.stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${failed ? '✗ 失败' : '✓ 全部通过'}：${passed} 项通过，${failed} 项失败`);
process.exit(failed ? 1 : 0);
