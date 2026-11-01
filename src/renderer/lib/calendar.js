// 日历「日视图」派生数据（GitHub 贡献图样式：近一年 × 按日热力）
//
// 为什么单独一个文件、而不是塞进 data.js：
// monthHeat 是「年 × 月」的 12 列矩阵，日视图是「周列 × 7 天」的二维网格，
// 两者的取整规则完全不同（月份只按日期字符串前缀分组；天要处理跨周对齐、未来日期、
// 色阶分级）。混在 data.js 里会让那块变成一坨 if。
//
// 这个模块是**纯函数**：不 import i18n / vue / DOM，所以 scripts/check-calendar.mjs
// 可以直接用 node 跑（i18n.js 依赖 import.meta.glob，node 里跑不了）。
// 星期名、月份名、每列从周几开始都由调用方（组件）按语言决定。

const DAY_MS = 86400000;
// 默认列数：53 周正好覆盖「近一年」（52 周 + 当前这一周；跨闰年也不会缺一天）
export const DEFAULT_WEEKS = 53;

const pad2 = (n) => String(n).padStart(2, '0');
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/* 日期一律按「UTC 日历日」计算：
 * 这里只关心「哪一天」，用 UTC 做加减可以彻底避开夏令时导致的 ±1 小时偏移
 * （本地时间戳 + 86400000 在部分地区会漂到前一天）。 */
function toUtcMs(iso) {
  const m = ISO_DAY.exec(String(iso || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 本机「今天」的日期字符串（按本地日历日，不看时区偏移） */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/* 色阶归一化上限：直接取当前数据集的最大值。
 * 用最大值而不是固定常数/分位数：颜色深浅应当反映「相对自己这段时间最多骑了多远」，
 * 这样尽可能多的格子能落在色带中段，区分度最好。
 * 区间内部是连续插值（不分档），所以 20km 与 60km 一定对应不同颜色。 */
export function scaleCeiling(values) {
  let max = 0;
  for (const v of values || []) {
    const n = Number(v);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // 空数据/全 0 时退回 1，避免调用方按 t 取色时除以 0
  return max > 0 ? max : 1;
}

/** 某天所在周的起始日（weekStart：0 = 周日，1 = 周一） */
function weekStartMs(ms, weekStart) {
  const dow = new Date(ms).getUTCDay();
  return ms - (((dow - weekStart) % 7) + 7) % 7 * DAY_MS;
}

/**
 * 网格锚点：最后一列包含这一天。默认今天；
 * 但数据全在一年以前（导入的是旧导出包）时锚到最后一条骑行，
 * 否则打开就是整整一年空白——那看起来像功能坏了。
 * @param {Array<{date:string}>} rides
 * @param {string} today
 * @param {number} firstMs 以今天为锚时网格的起始毫秒
 */
function pickAnchor(rides, today, firstMs) {
  let last = null;
  for (const r of rides || []) {
    const iso = String(r?.date || '').slice(0, 10);
    if (!ISO_DAY.test(iso)) continue;
    if (!last || iso > last) last = iso;
  }
  if (!last) return today;
  // 数据里有「未来」记录（时钟不准 / 手工造的数据）：网格一直画到最后一条
  if (last > today) return last;
  // 最近一年一次都没骑过：退回到最后一条骑行所在的周
  if (toUtcMs(last) < firstMs) return last;
  return today;
}

/**
 * 近一年按日热力网格。
 *
 * @param {Array<{date:string, distanceM?:number, durationMs?:number}>} rides 骑行记录
 * @param {object} [opts]
 * @param {string} [opts.anchor] 网格锚点日（最后一列包含这一天），默认按数据自动选
 * @param {string} [opts.today] 注入「今天」，便于测试
 * @param {number} [opts.weeks] 列数（周数），默认 53
 * @param {0|1} [opts.weekStart] 每列第一天的星期（0 周日 / 1 周一），跟随界面语言
 * @returns {{
 *   grid: Array<Array<{iso:string, day:number, month:number, distanceM:number, durationMs:number,
 *     count:number, t:number, future:boolean}>>,
 *   monthLabels: Array<{col:number, month:number}>,
 *   anchorIso: string, firstIso: string, lastIso: string,
 *   max: number, scaleMaxM: number,
 *   activeDays: number, totalDistanceM: number, totalCount: number, empty: boolean
 * }}
 */
export function yearHeat(rides, { anchor, today = todayIso(), weeks = DEFAULT_WEEKS, weekStart = 0 } = {}) {
  const ws = weekStart === 1 ? 1 : 0;
  const cols = Math.max(1, Math.floor(Number(weeks) || DEFAULT_WEEKS));

  const anchorBase = ISO_DAY.test(String(anchor || '')) ? String(anchor).slice(0, 10) : null;
  const todayIsoValue = ISO_DAY.test(String(today)) ? String(today).slice(0, 10) : todayIso();
  const probeFirstMs = weekStartMs(toUtcMs(todayIsoValue), ws) - (cols - 1) * 7 * DAY_MS;
  const anchorIso = anchorBase || pickAnchor(rides, todayIsoValue, probeFirstMs);
  const anchorMs = toUtcMs(anchorIso);
  const firstMs = weekStartMs(anchorMs, ws) - (cols - 1) * 7 * DAY_MS;

  // 先按天聚合：同一天骑两次要累加（里程 / 时长 / 次数），不能互相覆盖
  const byDay = new Map();
  for (const r of rides || []) {
    const iso = String(r?.date || '').slice(0, 10);
    if (!ISO_DAY.test(iso)) continue;
    const cur = byDay.get(iso) || { distanceM: 0, durationMs: 0, count: 0 };
    cur.distanceM += Number(r?.distanceM) || 0;
    cur.durationMs += Number(r?.durationMs) || 0;
    cur.count += 1;
    byDay.set(iso, cur);
  }

  const grid = [];
  const all = [];
  for (let c = 0; c < cols; c++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const ms = firstMs + (c * 7 + d) * DAY_MS;
      const iso = fromUtcMs(ms);
      const rec = byDay.get(iso);
      const cell = {
        iso,
        day: Number(iso.slice(8, 10)),
        month: Number(iso.slice(5, 7)),
        distanceM: rec ? +rec.distanceM.toFixed(1) : 0,
        durationMs: rec?.durationMs || 0,
        count: rec?.count || 0,
        t: 0,
        // 锚点之后的日期：留格子占位对齐，但渲染成透明（GitHub 贡献图也是这样）
        future: ms > anchorMs,
      };
      week.push(cell);
      all.push(cell);
    }
    grid.push(week);
  }

  /* 连续色阶用「固定里程范围」做归一化，不再分档：
   * 分档（无论按分位数还是固定刻度）最多只能表现 4 级台阶，20km 和 60km 很容易落进同一档。
   * 这里改为把里程按 0 → t 映射成 0-1 的强度 t，取色由调用方用 sampleGradient 连续插值，
   * 任意两个不同的里程都能得到不同的颜色，也仍然保持「颜色 ↔ 绝对里程」的对应关系
   * （不按当次数据的 min/max 归一化，否则跨数据集比较就失效了）。
   * 上限取 80km：常见骑行日里程基本落在这个范围内，超出部分一律最饱和。 */
  const positives = all.filter((c) => c.distanceM > 0 && !c.future).map((c) => c.distanceM);
  const scaleMaxM = scaleCeiling(positives);
  for (const cell of all) {
    // t 是 0-1 的连续强度，0 表示没骑行（渲染成空格底色）。
    // 下限 0.06 保证「刚骑了一点点」也能看出颜色深浅差异，不会和空白天混在一起。
    cell.t = cell.distanceM > 0 ? Math.max(0.06, Math.min(1, cell.distanceM / scaleMaxM)) : 0;
  }

  // 月份标签：某列里出现「1 号」就标这个月；首列补一个起始月。
  // 与前一个标签至少隔 3 列，避免 31 天的小月份标签挤在一起叠字。
  const monthLabels = [];
  let lastCol = -99;
  for (let c = 0; c < cols; c++) {
    const firstDayOfMonth = grid[c].find((cell) => cell.day === 1);
    const month = firstDayOfMonth ? firstDayOfMonth.month : c === 0 ? grid[c][0].month : null;
    if (month == null) continue;
    if (c - lastCol < 3) continue;
    monthLabels.push({ col: c, month });
    lastCol = c;
  }
  // 最后一列的月份标签在右边缘会被裁掉半个字（只剩「11」），而它标的多半是下一年同一个月、
  // 与首列标签重复，所以丢掉：留白比半个字干净。
  while (monthLabels.length > 1 && cols - monthLabels[monthLabels.length - 1].col < 2) monthLabels.pop();

  const max = positives.length ? Math.max(...positives) : 0;
  return {
    grid,
    monthLabels,
    anchorIso,
    firstIso: all[0].iso,
    lastIso: all[all.length - 1].iso,
    max,
    // 连续色阶的归一化上限（米，已剔除异常点）：调用方按 cell.t（0-1）在色带上取色
    scaleMaxM,
    activeDays: positives.length,
    totalDistanceM: +positives.reduce((s, v) => s + v, 0).toFixed(1),
    totalCount: all.reduce((s, c) => s + (c.future ? 0 : c.count), 0),
    empty: positives.length === 0,
  };
}
