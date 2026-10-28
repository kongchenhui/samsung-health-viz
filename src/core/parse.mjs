// 解析三星健康导出包（CSV + jsons），生成本应用需要的骑行数据集。
// 纯 Node 模块：Electron 主进程与 scripts/prepare-data.mjs 共用。
import fs from 'node:fs';
import { buildDeviceIndex, detectCoordSys } from './coord-sys.mjs';
import path from 'node:path';
import AdmZip from 'adm-zip';

/* ---------------- 通用工具 ---------------- */

const ROOT_PREFIX_RE = /^[^/]+\//;

/** 数据集结构版本：增加字段时 +1，旧缓存会被忽略并要求重新选择数据包 */
export const SCHEMA = 4;

/**
 * 用户可见文案（进度 / 警告 / 错误）按 locale 输出。
 * 本模块被主进程与 scripts/ 直接调用，默认中文，`en` 时输出英文。
 */
function msg(locale, zh, en) {
  return locale === 'en' ? en : zh;
}

export function folderReader(root) {
  const files = [];
  const walk = (dir, base) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else files.push(rel);
    }
  };
  walk(root, '');
  const set = new Set(files);
  return {
    kind: 'folder',
    label: root,
    listFiles: () => files.slice(),
    hasFile: (rel) => set.has(rel),
    readText: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    readJson: (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')),
  };
}

export function zipReader(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = new Map();
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = e.entryName.replace(ROOT_PREFIX_RE, '');
    entries.set(rel, e);
  }
  const files = [...entries.keys()];
  return {
    kind: 'zip',
    label: zipPath,
    listFiles: () => files.slice(),
    hasFile: (rel) => entries.has(rel),
    readText: (rel) => entries.get(rel).getData().toString('utf8'),
    readJson: (rel) => JSON.parse(entries.get(rel).getData().toString('utf8')),
  };
}

/** 兼容用户选到“解压包的上一级目录”：向下找一层包含三星 CSV 的目录 */
export function resolvePackageDir(dir) {
  const looksLikePackage = (d) => {
    try {
      return fs.readdirSync(d).some((f) => /^com\.samsung\.shealth\.exercise\.\d+\.csv$/.test(f));
    } catch {
      return false;
    }
  };
  if (looksLikePackage(dir)) return dir;
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
      if (isDir && looksLikePackage(full)) return full;
    }
  } catch { /* ignore */ }
  return dir;
}

export function detectPackages(dir) {
  // 返回 dir 下像是“三星健康解压包”的目录列表
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let isDir = false;
    try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const hasCsv = fs.readdirSync(full).some((f) => f.endsWith('.csv'));
    if (hasCsv) out.push(full);
  }
  return out;
}

/* ---------------- CSV ---------------- */

/** 按 RFC4180 解析 CSV 文本（支持引号、转义引号、字段内逗号与换行）。 */
export function parseCsvText(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // 忽略，交给 \n 处理
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * 三星健康 CSV：第 1 行是类型+版本，第 2 行是表头，数据行比表头多一个尾部空字段。
 * 返回 { headers, records: Array<Object>, metaLine }
 */
export function parseSamsungCsv(text) {
  const rows = parseCsvText(text);
  if (rows.length < 2) return { headers: [], records: [], metaLine: '' };
  const metaLine = rows[0].join(',');
  const headers = rows[1];
  const records = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length) continue;
    // 数据行 = 表头长度 + 1（最后一个是空字符串）
    const rec = {};
    for (let c = 0; c < headers.length; c++) rec[headers[c]] = r[c] ?? '';
    records.push(rec);
  }
  return { headers, records, metaLine };
}

/* ---------------- 基础数学 ---------------- */

const R = 6371000;
export function haversine(a, b) {
  const la1 = (a[0] * Math.PI) / 180, lo1 = (a[1] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180, lo2 = (b[1] * Math.PI) / 180;
  const dla = (la2 - la1) / 2, dlo = (lo2 - lo1) / 2;
  const h = Math.sin(dla) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 修复导出包里个别字段的“UTF-8 被当成 latin1”双重编码（如天气短语）。 */
export function fixMojibake(s) {
  if (!s || typeof s !== 'string') return s;
  if (!/[\u00c0-\u00ff]/.test(s)) return s;
  try {
    const repaired = Buffer.from(s, 'latin1').toString('utf8');
    if (/[\u4e00-\u9fa5]/.test(repaired) && !/[\ufffd]/.test(repaired)) return repaired;
  } catch { /* ignore */ }
  return s;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 解析 CSV 中的 UTC 时间字符串（YYYY-MM-DD HH:MM:SS.mmm）为毫秒。 */
export function parseUtcMs(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, ms] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, ms ? +ms.padEnd(3, '0') : 0);
}

export function fmtLocal(ms) {
  // 转成本地时区的 ISO 字符串（数据均为 Asia/Shanghai）
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`;
}

function pick(rec, suffix) {
  if (!rec) return '';
  if (suffix in rec) return rec[suffix];
  for (const k of Object.keys(rec)) {
    if (k.split('.').pop() === suffix) return rec[k];
  }
  return '';
}

function downsample(points, maxN) {
  if (points.length <= maxN) return points;
  const out = [];
  const step = (points.length - 1) / (maxN - 1);
  for (let i = 0; i < maxN; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Douglas-Peucker 轨迹简化（以米为容差，经纬度转局部平面近似）。 */
function simplifyTrack(pts, tolerance = 2.5) {
  if (pts.length <= 2) return pts;
  const lat0 = pts[0].lat, lon0 = pts[0].lon;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const xy = pts.map((p) => [(p.lon - lon0) * kx, (p.lat - lat0) * ky]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function smoothAltitude(alt) {
  if (!alt || alt.length < 5) return alt;
  const out = new Array(alt.length);
  const win = 7;
  for (let i = 0; i < alt.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(alt.length - 1, i + win); j++) {
      if (alt[j] != null && Number.isFinite(alt[j])) { sum += alt[j]; cnt++; }
    }
    out[i] = cnt ? sum / cnt : alt[i];
  }
  return out;
}

/* ---------------- 数据集构建 ---------------- */

const T = {
  exercise: /^com\.samsung\.shealth\.exercise\.\d+\.csv$/,
  weather: /^com\.samsung\.shealth\.exercise\.weather\.\d+\.csv$/,
  recovery: /^com\.samsung\.shealth\.exercise\.recovery_heart_rate\.\d+\.csv$/,
  heartRate: /^com\.samsung\.shealth\.tracker\.heart_rate\.\d+\.csv$/,
  deviceProfile: /^com\.samsung\.health\.device_profile\.\d+\.csv$/,
  bestRecords: /^com\.samsung\.shealth\.best_records\.\d+\.csv$/,
  sleep: null,
};

function findCsv(reader, re) {
  const hit = reader.listFiles().find((f) => re.test(f));
  return hit || null;
}

function jsonPath(typeDir, name) {
  // name 形如 UUID.xxx.json；jsons/<类型>/<首字符>/<name>
  return `jsons/${typeDir}/${name[0]}/${name}`;
}

export function buildCyclingDataset(reader, opts = {}) {
  const t0 = Date.now();
  const warnings = [];
  const locale = opts.locale === 'en' ? 'en' : 'zh';

  const exFile = findCsv(reader, T.exercise);
  if (!exFile) {
    throw new Error(
      msg(
        locale,
        '这个目录/压缩包里找不到 com.samsung.shealth.exercise.*.csv，可能不是三星健康导出包',
        'No com.samsung.shealth.exercise.*.csv found in this folder/archive — it may not be a Samsung Health export'
      )
    );
  }
  const ex = parseSamsungCsv(reader.readText(exFile));

  // 坐标基准判定逻辑集中在 core/coord-sys.mjs（含实测依据、判定顺序与修改指引）
  const deviceFile = findCsv(reader, T.deviceProfile);
  const deviceIndex = deviceFile
    ? buildDeviceIndex(parseSamsungCsv(reader.readText(deviceFile)).records)
    : new Map();

  const weatherFile = findCsv(reader, T.weather);
  const weatherByExercise = new Map();
  if (weatherFile) {
    for (const rec of parseSamsungCsv(reader.readText(weatherFile)).records) {
      const id = pick(rec, 'exercise_id');
      if (!id) continue;
      weatherByExercise.set(id, {
        temperature: num(rec.temperature),
        humidity: num(rec.humidity),
        windSpeed: num(rec.wind_speed),
        windUnit: rec.wind_speed_unit || 'km/h',
        windDirection: fixMojibake(rec.wind_direction) || '',
        phrase: fixMojibake(rec.phrase) || '',
        provider: fixMojibake(rec.content_provider) || '',
      });
    }
  }

  const recoveryFile = findCsv(reader, T.recovery);
  const recoveryByExercise = new Map();
  if (recoveryFile) {
    for (const rec of parseSamsungCsv(reader.readText(recoveryFile)).records) {
      const id = pick(rec, 'exercise_id');
      const file = pick(rec, 'heart_rate');
      if (!id || !file) continue;
      recoveryByExercise.set(id, file);
    }
  }

  // 心率桶（用于没有 live_data 心率的骑行）
  const hrIndex = [];
  const hrFile = findCsv(reader, T.heartRate);
  if (hrFile) {
    for (const rec of parseSamsungCsv(reader.readText(hrFile)).records) {
      const st = parseUtcMs(pick(rec, 'start_time'));
      const et = parseUtcMs(pick(rec, 'end_time'));
      const file = pick(rec, 'binning_data');
      if (st == null || et == null || !file) continue;
      hrIndex.push({ st, et, file });
    }
  }

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const cyclingRecs = ex.records.filter((rec) => String(pick(rec, 'exercise_type') || '') === '11007');
  if (onProgress) {
    onProgress(
      msg(locale, `找到 ${cyclingRecs.length} 条骑行记录`, `Found ${cyclingRecs.length} cycling ride${cyclingRecs.length === 1 ? '' : 's'}`),
      10
    );
  }

  const rides = [];
  for (let ri = 0; ri < cyclingRecs.length; ri++) {
    const rec = cyclingRecs[ri];
    if (onProgress && (ri % 2 === 0 || ri === cyclingRecs.length - 1)) {
      onProgress(
        msg(
          locale,
          `解析轨迹与心率 ${ri + 1}/${cyclingRecs.length}`,
          `Parsing tracks and heart rate ${ri + 1}/${cyclingRecs.length}`
        ),
        12 + Math.round((80 * ri) / Math.max(1, cyclingRecs.length))
      );
    }
    const id = pick(rec, 'datauuid');
    const deviceuuid = pick(rec, 'deviceuuid');
    const device = deviceIndex.get(deviceuuid);
    // 默认值：无轨迹的骑行只用它；有轨迹时下面读到 location_data.json 后会按点格式重判
    let coordSys = detectCoordSys(device, null);
    const startMs = parseUtcMs(pick(rec, 'start_time'));
    const endMs = parseUtcMs(pick(rec, 'end_time'));
    const durationMs = num(pick(rec, 'duration')) ?? (endMs != null && startMs != null ? endMs - startMs : null);
    if (startMs == null || durationMs == null) continue;
    const effectiveEnd = endMs ?? startMs + durationMs;
    // 墙钟跨度（含自动暂停）：三星的 duration 是“运动时长”，不含暂停；而轨迹/live_data 的时间戳是墙钟时间。
    // 若用 duration 裁剪，会把暂停之后的尾段（例如返程最后几分钟）整段截掉，轨迹看起来就“没闭合”。
    const wallSpanMs = endMs != null && startMs != null && endMs > startMs ? endMs - startMs : durationMs;

    let distanceM = num(pick(rec, 'distance'));
    let calories = num(pick(rec, 'calorie')) ?? num(pick(rec, 'total_calorie'));
    const meanHr = num(pick(rec, 'mean_heart_rate'));
    const maxHr = num(pick(rec, 'max_heart_rate'));
    const minHr = num(pick(rec, 'min_heart_rate'));
    let maxSpeed = num(pick(rec, 'max_speed'));
    const altGain = num(pick(rec, 'altitude_gain'));
    const altLoss = num(pick(rec, 'altitude_loss'));
    const vo2max = num(pick(rec, 'vo2_max'));

    // ---- 轨迹 ----
    let track = null;
    const locFile = pick(rec, 'location_data');
    if (locFile) {
      try {
        const raw = reader.readJson(jsonPath('com.samsung.shealth.exercise', locFile));
        // 按“轨迹点格式（version）+ 设备类型回退”判定坐标基准
        coordSys = detectCoordSys(device, raw);
        let pts = [];
        for (const p of raw) {
          if (p == null || p.latitude == null || p.longitude == null) continue;
          if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
          if (Math.abs(p.latitude) < 1e-6 && Math.abs(p.longitude) < 1e-6) continue;
          pts.push({
            lat: +p.latitude.toFixed(6),
            lon: +p.longitude.toFixed(6),
            alt: p.altitude != null && Number.isFinite(p.altitude) ? +p.altitude.toFixed(1) : null,
            t: p.start_time != null ? p.start_time : null,
            acc: p.accuracy != null ? p.accuracy : null,
          });
        }
        if (pts.length >= 2) {
          // 先按距离/时间抽稀，再做几何简化
          const picked = [];
          let last = null;
          for (const p of pts) {
            if (!last) { picked.push(p); last = p; continue; }
            const d = haversine([last.lat, last.lon], [p.lat, p.lon]);
            const dt = p.t != null && last.t != null ? (p.t - last.t) / 1000 : 0;
            if (d >= 3 || dt >= 5) { picked.push(p); last = p; }
          }
          if (picked[picked.length - 1] !== pts[pts.length - 1]) picked.push(pts[pts.length - 1]);
          const simplified = simplifyTrack(picked, 2.5)
            .filter((p) => p.t == null || (p.t - startMs >= -30000 && p.t - startMs <= wallSpanMs + 60000));
          if (simplified.length >= 2) track = { pts: simplified };
        }
      } catch (e) {
        warnings.push(msg(locale, `轨迹读取失败 ${id}: ${e.message}`, `Failed to read track ${id}: ${e.message}`));
      }
    }

    // ---- live_data：速度 / 里程增量 / 心率 ----
    const liveFile = pick(rec, 'live_data');
    const speedPts = [];
    const hrPts = [];
    const distPts = [];
    if (liveFile) {
      try {
        const live = reader.readJson(jsonPath('com.samsung.shealth.exercise', liveFile));
        for (const p of live) {
          if (p.start_time == null) continue;
          const t = (p.start_time - startMs) / 1000;
          if (t < -5 || t > wallSpanMs / 1000 + 5) continue;
          if (p.speed != null && Number.isFinite(p.speed) && p.speed >= 0 && p.speed <= 20) {
            speedPts.push([+t.toFixed(1), +p.speed.toFixed(2)]);
          }
          if (p.heart_rate != null && Number.isFinite(p.heart_rate) && p.heart_rate >= 30 && p.heart_rate <= 220) {
            hrPts.push([+t.toFixed(1), Math.round(p.heart_rate)]);
          }
          if (p.distance != null && Number.isFinite(p.distance)) {
            distPts.push({ t, d: p.distance, cal: p.calorie != null && Number.isFinite(p.calorie) ? p.calorie : 0 });
          }
        }
      } catch (e) {
        warnings.push(
          msg(locale, `运动采样读取失败 ${id}: ${e.message}`, `Failed to read workout samples ${id}: ${e.message}`)
        );
      }
    }

    // 用 live_data 的距离增量算累计里程与每公里分段
    let cum = 0;
    const cumPts = [];
    for (const p of distPts) {
      cum += p.d;
      cumPts.push({ t: p.t, d: cum });
    }
    const splits = [];
    if (cum > 100) {
      if (distanceM == null) distanceM = +cum.toFixed(1);
      let nextKm = 1000;
      let prevCross = 0;
      for (let i = 1; i < cumPts.length; i++) {
        const prev = cumPts[i - 1], cur = cumPts[i];
        while (cur.d >= nextKm) {
          const ratio = (nextKm - prev.d) / (cur.d - prev.d || 1);
          const tCross = prev.t + (cur.t - prev.t) * Math.max(0, Math.min(1, ratio));
          splits.push({ km: nextKm / 1000, t: +tCross.toFixed(1), sec: +(tCross - prevCross).toFixed(1) });
          prevCross = tCross;
          nextKm += 1000;
        }
      }
    }

    // 心率兜底：从 tracker.heart_rate 的分钟桶里取
    let hrFallback = [];
    if (!hrPts.length && hrIndex.length) {
      const winStart = startMs - 120000, winEnd = effectiveEnd + 120000;
      const buckets = hrIndex.filter((b) => b.et >= winStart && b.st <= winEnd);
      for (const b of buckets) {
        try {
          const raw = reader.readJson(jsonPath('com.samsung.shealth.tracker.heart_rate', b.file));
          for (const p of raw) {
            if (p.heart_rate == null || p.start_time == null) continue;
            if (p.heart_rate < 30 || p.heart_rate > 220) continue;
            if (p.start_time < winStart || p.start_time > winEnd) continue;
            hrFallback.push([+((p.start_time - startMs) / 1000).toFixed(1), Math.round(p.heart_rate)]);
          }
        } catch { /* 桶可能缺失 */ }
      }
      hrFallback.sort((a, b) => a[0] - b[0]);
      // 去重（同一秒保留最后一个）
      const dedup = [];
      for (const p of hrFallback) {
        if (dedup.length && Math.abs(dedup[dedup.length - 1][0] - p[0]) < 1.5) dedup[dedup.length - 1] = p;
        else dedup.push(p);
      }
      hrFallback = dedup;
    }

    // 恢复心率
    let recoveryHr = null;
    const rcFile = recoveryByExercise.get(id);
    if (rcFile) {
      try {
        const raw = reader.readJson(jsonPath('com.samsung.shealth.exercise.recovery_heart_rate', rcFile));
        const arr = Array.isArray(raw?.chart_data) ? raw.chart_data : [];
        const pts = arr
          .filter((p) => p.heart_rate != null)
          .map((p) => [+((p.elapsed_time ?? 0) / 1000).toFixed(0), Math.round(p.heart_rate)]);
        if (pts.length >= 2) recoveryHr = pts;
      } catch { /* ignore */ }
    }

    // 组装轨迹数组
    let trackData = null;
    let elevGain = altGain, elevLoss = altLoss;
    if (track) {
      const pts = track.pts;
      const lat = pts.map((p) => p.lat);
      const lon = pts.map((p) => p.lon);
      const tArr = pts.map((p) => (p.t != null ? +((p.t - startMs) / 1000).toFixed(0) : null));
      const altArr = smoothAltitude(pts.map((p) => p.alt));
      // 时间缺失时用线性插值填充
      if (tArr.some((v) => v == null)) {
        for (let i = 0; i < tArr.length; i++) {
          if (tArr[i] == null) tArr[i] = i === 0 ? 0 : tArr[i - 1] + 1;
        }
      }
      if (elevGain == null && elevLoss == null && altArr.some((v) => v != null)) {
        let g = 0, l = 0;
        let prev = null;
        for (const a of altArr) {
          if (a == null) continue;
          if (prev != null) {
            const d = a - prev;
            if (d > 0.2) g += d; else if (d < -0.2) l += -d;
          }
          prev = a;
        }
        if (elevGain == null) elevGain = +g.toFixed(0);
        if (elevLoss == null) elevLoss = +l.toFixed(0);
      }
      trackData = { lat, lon, t: tArr, alt: altArr };
    }

    // 速度序列兜底：用距离增量 / 时间差
    let speedSeries = speedPts;
    if (!speedSeries.length && cumPts.length > 2) {
      speedSeries = [];
      for (let i = 1; i < cumPts.length; i++) {
        const dt = cumPts[i].t - cumPts[i - 1].t;
        const dd = cumPts[i].d - cumPts[i - 1].d;
        if (dt > 0.2) speedSeries.push([+cumPts[i].t.toFixed(1), +(dd / dt).toFixed(2)]);
      }
    }
    speedSeries = downsample(speedSeries, 600);
    const hrSeries = hrPts.length ? downsample(hrPts, 600) : downsample(hrFallback, 600);

    const avgSpeed = distanceM != null && durationMs > 0 ? distanceM / (durationMs / 1000) : null;
    const seriesMax = speedSeries.length ? Math.max(...speedSeries.map((p) => p[1])) : null;
    if (seriesMax != null && (maxSpeed == null || maxSpeed > 20)) maxSpeed = seriesMax;
    if (calories == null && cumPts.length) calories = +cumPts.reduce((s, p) => s + (p.cal || 0), 0).toFixed(1);

    const ride = {
      id,
      deviceuuid,
      coordSys,
      date: fmtLocal(startMs).slice(0, 10),
      start: fmtLocal(startMs),
      end: fmtLocal(effectiveEnd),
      startMs,
      durationMs,
      distanceM: distanceM != null ? +distanceM.toFixed(1) : null,
      calories: calories != null ? +calories.toFixed(1) : null,
      avgSpeedMps: avgSpeed != null ? +avgSpeed.toFixed(3) : null,
      maxSpeedMps: maxSpeed != null ? +maxSpeed.toFixed(3) : null,
      meanHr, maxHr, minHr,
      elevGainM: elevGain != null ? +elevGain.toFixed(1) : null,
      elevLossM: elevLoss != null ? +elevLoss.toFixed(1) : null,
      vo2max,
      hasTrack: !!trackData,
      track: trackData,
      speed: speedSeries,
      hr: hrSeries,
      recoveryHr,
      splits,
      weather: weatherByExercise.get(id) || null,
      startPoint: trackData ? [lat0Of(trackData), lon0Of(trackData)] : null,
    };
    rides.push(ride);
  }

  rides.sort((a, b) => a.startMs - b.startMs);
  if (onProgress) onProgress(msg(locale, '汇总生涯数据…', 'Summarizing career stats…'), 94);

  const name = detectPackageName(reader.label);
  const meta = {
    schema: SCHEMA,
    kind: 'samsung-health-cycling',
    packageName: name.packageName,
    exportTime: name.exportTime,
    generatedAt: new Date().toISOString(),
    source: reader.label,
    sourceKind: reader.kind,
    ridesTotal: rides.length,
    ridesWithTrack: rides.filter((r) => r.hasTrack).length,
    distanceM: +rides.reduce((s, r) => s + (r.distanceM || 0), 0).toFixed(1),
    durationMs: rides.reduce((s, r) => s + (r.durationMs || 0), 0),
    parseMs: Date.now() - t0,
    warnings: warnings.slice(0, 20),
  };
  return { meta, rides };
}

function lat0Of(t) { return t.lat[0]; }
function lon0Of(t) { return t.lon[0]; }

export function detectPackageName(label) {
  const base = String(label).replace(/\/+$/, '').split('/').pop() || '';
  const m = base.match(/samsunghealth_(\d+)_(\d{14})/);
  if (!m) return { packageName: null, exportTime: null };
  const [, phone, ts] = m;
  const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(8, 10), mi = ts.slice(10, 12), se = ts.slice(12, 14);
  return { packageName: phone, exportTime: `${y}-${mo}-${d}T${h}:${mi}:${se}+08:00` };
}
