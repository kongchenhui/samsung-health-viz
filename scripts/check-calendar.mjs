// 骑行日历「天视图」纯逻辑自检（node scripts/check-calendar.mjs）
//
// 为什么单独一个脚本：src/renderer/lib/calendar.js 刻意不依赖 i18n / vue / DOM，
// 就是为了能在 node 里直接跑；天视图的坑全在「跨周对齐 / 未来占位 / 连续色阶取色」
// 这些纯计算上，靠肉眼点界面看不出来，改动后必须跑这里。
//
// 测试数据全部虚构（只有日期、里程、时长这些自造数值），不含任何真实骑行记录、账号或本机路径。
import assert from 'node:assert/strict';
import { yearHeat, todayIso, DEFAULT_WEEKS, scaleCeiling } from '../src/renderer/lib/calendar.js';
import { sampleGradient, mixColor, parseColor } from '../src/renderer/lib/color-scale.js';

const DAY_MS = 86400000;
// 固定「今天」，否则用例结果会随运行日期漂移（哪天跑都该是同一结论）
const TODAY = '2026-06-15';

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

/* ---------------- 测试小工具 ---------------- */
const utcMs = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const utcDow = (iso) => new Date(utcMs(iso)).getUTCDay();
const allCells = (heat) => heat.grid.flat();
const cellMap = (heat) => new Map(allCells(heat).map((c) => [c.iso, c]));
/** 造一条虚构骑行记录 */
const ride = (date, distanceM = 10000, durationMs = 1800000) => ({ date, distanceM, durationMs });
/** 从某天起连续 n 天，每天一条记录，里程由 fn 决定 */
function dailyRides(startIso, n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(startIso, i));
  return out;
}
const shiftIso = (iso, days) => {
  const d = new Date(utcMs(iso) + days * DAY_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/* ---------------- 1. 常量与网格形状 ---------------- */
await test('常量：DEFAULT_WEEKS = 53', () => {
  assert.equal(DEFAULT_WEEKS, 53);
});

await test('默认网格：53 列 × 7 天 = 371 格，每列正好 7 天', () => {
  const heat = yearHeat([], { today: TODAY });
  assert.equal(heat.grid.length, 53);
  assert.equal(heat.grid.length, DEFAULT_WEEKS);
  for (const week of heat.grid) assert.equal(week.length, 7);
  assert.equal(allCells(heat).length, 371);
});

await test('日期连续无空洞：相邻 cell 正好差 1 天', () => {
  const cells = allCells(yearHeat([], { today: TODAY }));
  for (let i = 1; i < cells.length; i++) {
    assert.equal(
      utcMs(cells[i].iso) - utcMs(cells[i - 1].iso),
      DAY_MS,
      `${cells[i - 1].iso} → ${cells[i].iso} 不连续`,
    );
  }
});

await test('cell 字段自洽：iso / day / month 互相匹配，且 iso 是 YYYY-MM-DD', () => {
  for (const c of allCells(yearHeat([], { today: TODAY }))) {
    assert.match(c.iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.day, Number(c.iso.slice(8, 10)));
    assert.equal(c.month, Number(c.iso.slice(5, 7)));
    assert.ok(c.month >= 1 && c.month <= 12);
  }
});

/* ---------------- 2. 每列起始星期 ---------------- */
await test('weekStart 默认 0：每列第一天是周日', () => {
  const heat = yearHeat([], { today: TODAY });
  for (const [i, week] of heat.grid.entries()) {
    assert.equal(utcDow(week[0].iso), 0, `第 ${i} 列首日 ${week[0].iso} 不是周日`);
  }
});

await test('weekStart: 1：每列第一天是周一', () => {
  const heat = yearHeat([], { today: TODAY, weekStart: 1 });
  for (const [i, week] of heat.grid.entries()) {
    assert.equal(utcDow(week[0].iso), 1, `第 ${i} 列首日 ${week[0].iso} 不是周一`);
  }
});

/* ---------------- 3. 锚点与未来占位 ---------------- */
await test('锚点 = 今天：最后一列包含今天', () => {
  const heat = yearHeat([], { today: TODAY });
  assert.equal(heat.anchorIso, TODAY);
  const lastCol = heat.grid[heat.grid.length - 1];
  assert.ok(lastCol.some((c) => c.iso === TODAY), `最后一列 ${lastCol[0].iso}~${lastCol[6].iso} 不含今天`);
});

await test('future 只出现在最后一列，且都是今天之后的日期', () => {
  const heat = yearHeat([], { today: TODAY });
  const last = heat.grid[heat.grid.length - 1];
  for (const [c, week] of heat.grid.entries()) {
    for (const cell of week) {
      if (cell.future) {
        assert.equal(c, heat.grid.length - 1, `非最后一列（第 ${c} 列）出现 future：${cell.iso}`);
        assert.ok(cell.iso > TODAY, `future cell ${cell.iso} 不晚于今天 ${TODAY}`);
      }
    }
  }
  // 今天本身（锚点日）不算未来
  assert.equal(last.find((c) => c.iso === TODAY).future, false);
});

await test('默认参数（真实今天）不抛错，且最后一列含 todayIso()', () => {
  const today = todayIso();
  const heat = yearHeat([]);
  assert.equal(heat.anchorIso, today);
  assert.ok(heat.grid[heat.grid.length - 1].some((c) => c.iso === today));
});

/* ---------------- 4. 同日聚合 ---------------- */
await test('同一天两条骑行：count=2、里程与时长累加（不是覆盖）', () => {
  const heat = yearHeat([ride(TODAY, 5000, 600000), ride(TODAY, 3000, 300000)], { today: TODAY });
  const cell = cellMap(heat).get(TODAY);
  assert.equal(cell.count, 2);
  assert.equal(cell.distanceM, 8000);
  assert.equal(cell.durationMs, 900000);
  assert.equal(heat.activeDays, 1);
  assert.equal(heat.totalCount, 2);
  assert.equal(heat.totalDistanceM, 8000);
});

/* ---------------- 5. 色阶 ---------------- */
await test('连续色阶：没骑行的天 t = 0', () => {
  for (const c of allCells(yearHeat([], { today: TODAY }))) assert.equal(c.t, 0);
});

await test('连续色阶：有骑行的天 t 在 (0, 1] 且与里程单调', () => {
  const heat = yearHeat(
    [ride(TODAY, 12345), ride(shiftIso(TODAY, -100), 4000), ride(shiftIso(TODAY, -200), 60000)],
    { today: TODAY },
  );
  const cells = allCells(heat);
  for (const c of cells) {
    if (c.distanceM > 0) assert.ok(c.t > 0 && c.t <= 1, `${c.iso} 有里程却 t=${c.t}`);
    else assert.equal(c.t, 0);
  }
  const sorted = cells.filter((c) => c.distanceM > 0).sort((a, b) => a.distanceM - b.distanceM);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].t >= sorted[i - 1].t, '里程越大 t 不能更小');
  }
});

await test('连续色阶：20km 与 60km 必须得到不同颜色（曾经的 bug）', () => {
  // 曾经按分位数/固定档位切档，20km 和 60km 会落进同一档显示成同一个颜色。
  // 连续插值下任意两个不同里程都应对应不同颜色。
  const stops = [
    { at: 0, color: 'rgba(255, 176, 46, 0.10)' },
    { at: 0.5, color: 'rgba(255, 176, 46, 0.55)' },
    { at: 1, color: '#ffb02e' },
  ];
  const MAX = 80000;
  const c20 = sampleGradient(20000, 0, MAX, stops);
  const c60 = sampleGradient(60000, 0, MAX, stops);
  assert.notEqual(c20, c60, `20km 与 60km 颜色相同：${c20}`);
});

await test('连续色阶：越界值夹到两端颜色，退化区间不产生 NaN', () => {
  const stops = [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }];
  assert.equal(sampleGradient(-100, 0, 100, stops), mixColor('#000000', '#ffffff', 0));
  assert.equal(sampleGradient(1e9, 0, 100, stops), mixColor('#000000', '#ffffff', 1));
  // min === max：返回首色而不是 NaN/透明
  assert.equal(sampleGradient(5, 5, 5, stops), '#000000');
  // 单停靠点
  assert.equal(sampleGradient(5, 0, 100, [{ at: 0, color: '#123456' }]), '#123456');
});

await test('连续色阶：mixColor 支持半透明端点的 alpha 插值', () => {
  const a = parseColor(mixColor('rgba(255,176,46,0.10)', 'rgba(255,176,46,0.55)', 0.5));
  assert.ok(a && Math.abs(a.a - 0.325) < 0.01, `alpha 应插值到 0.325，实际 ${a && a.a}`);
  // 若两端都不透明，返回 hex
  assert.ok(mixColor('#000000', '#ffffff', 0.5).startsWith('#'), '不透明端点应返回 hex');
});

await test('scaleCeiling：上限取当前数据集最大值', () => {
  assert.equal(scaleCeiling([10000, 30000, 200000]), 200000);
  // 最大值那天必然染到满档
  const heat = yearHeat(
    [ride('2026-01-01', 10000), ride('2026-01-02', 30000), ride('2026-01-03', 200000)],
    { today: TODAY },
  );
  const peak = allCells(heat).find((c) => c.distanceM === 200000);
  assert.equal(peak.t, 1, `最大值应染满档，实际 t=${peak.t}`);
  assert.equal(heat.scaleMaxM, 200000);
});

await test('scaleCeiling：空输入 / 全 0 / 非法值退化为 1，不返回 0', () => {
  assert.equal(scaleCeiling([]), 1);
  assert.equal(scaleCeiling([0, 0]), 1);
  assert.equal(scaleCeiling(null), 1);
  assert.equal(scaleCeiling([NaN, -5, null]), 1);
  assert.equal(scaleCeiling([5000, 'abc']), 5000);
});

await test('闰年锚点 2028-02-29：不抛错，首尾相差正好 370 天', () => {
  const heat = yearHeat([ride('2028-02-29', 30000)], { today: '2028-02-29' });
  assert.equal(heat.anchorIso, '2028-02-29');
  assert.equal(heat.grid.length, 53);
  assert.equal(allCells(heat).length, 371);
  assert.equal(utcMs(heat.lastIso) - utcMs(heat.firstIso), 370 * DAY_MS);
  assert.equal(cellMap(heat).get('2028-02-29').distanceM, 30000);
  // 跨过 2 月 29 日这一天本身也必须在网格里
  assert.ok(cellMap(heat).has('2028-02-29'));
});

await test('跨年锚点：1 月初回看一年不会缺 12 月', () => {
  const heat = yearHeat([], { today: '2026-01-02' });
  assert.ok(heat.firstIso < '2025-01-03');
  const months = new Set(allCells(heat).map((c) => `${c.iso.slice(0, 4)}-${c.month}`));
  assert.ok(months.has('2025-12'), '网格里缺少 2025-12');
});

/* ---------------- 7. 空数据 ---------------- */
await test('空数据：empty = true、activeDays 0、不抛错、grid 仍是 371 格', () => {
  const heat = yearHeat([], { today: TODAY });
  assert.equal(heat.empty, true);
  assert.equal(heat.activeDays, 0);
  assert.equal(heat.totalDistanceM, 0);
  assert.equal(heat.totalCount, 0);
  assert.equal(heat.max, 0);
  // 连续色阶：没有数据时上限退化为 1，避免调用方按 cell.t 取色时除以 0，
  // 同时保证返回的是有限正数（图例色带仍能画出来）。
  assert.equal(heat.scaleMaxM, 1);
  assert.ok(Number.isFinite(heat.scaleMaxM) && heat.scaleMaxM > 0);
  assert.equal(allCells(heat).length, 371);
});

await test('空数据边界：undefined / null 也当作没有记录', () => {
  for (const input of [undefined, null]) {
    const heat = yearHeat(input, { today: TODAY });
    assert.equal(heat.empty, true);
    assert.equal(allCells(heat).length, 371);
  }
});

/* ---------------- 8. 非法日期过滤 ---------------- */
await test('非法日期（空串 / abc / null / 缺 date）被跳过，不污染 byDay', () => {
  const dirty = [
    ride('', 9999),
    { date: 'abc', distanceM: 8888 },
    { date: null, distanceM: 7777 },
    { distanceM: 6666 },
    ride(TODAY, 10000),
  ];
  const heat = yearHeat(dirty, { today: TODAY });
  const cells = cellMap(heat);
  // 只有那条合法记录被统计
  assert.equal(heat.activeDays, 1);
  assert.equal(heat.totalCount, 1);
  assert.equal(heat.totalDistanceM, 10000);
  assert.equal(cells.get(TODAY).distanceM, 10000);
  // 其它格子一律 0，非法记录的里程没有漏到任何一天
  const leaked = allCells(heat).filter((c) => c.distanceM !== 0 && c.iso !== TODAY);
  assert.deepEqual(leaked.map((c) => c.iso), []);
});

/* ---------------- 9. 锚点回退（旧导出包） ---------------- */
await test('锚点回退：数据全在一年以前时锚到最后一条那天', () => {
  const heat = yearHeat([ride('2020-05-01', 25000, 3600000)], { today: TODAY });
  assert.equal(heat.anchorIso, '2020-05-01');
  const cell = cellMap(heat).get('2020-05-01');
  assert.ok(cell, '锚点日不在网格里');
  assert.equal(cell.future, false);
  assert.equal(cell.distanceM, 25000);
  // 锚点所在列就是最后一列
  assert.ok(heat.grid[heat.grid.length - 1].some((c) => c.iso === '2020-05-01'));
});

await test('锚点规则：数据里有「未来」记录时锚到最后一条', () => {
  const futureIso = '2027-01-01';
  const heat = yearHeat([ride(TODAY, 10000), ride(futureIso, 20000)], { today: TODAY });
  assert.equal(heat.anchorIso, futureIso);
  const cell = cellMap(heat).get(futureIso);
  assert.equal(cell.future, false);
  assert.equal(cell.distanceM, 20000);
});

await test('显式 anchor 优先于自动选锚点', () => {
  const heat = yearHeat([ride('2020-05-01', 25000)], { today: TODAY, anchor: '2025-12-25' });
  assert.equal(heat.anchorIso, '2025-12-25');
  assert.ok(heat.grid[heat.grid.length - 1].some((c) => c.iso === '2025-12-25'));
});

/* ---------------- 10. 月份标签 ---------------- */
await test('monthLabels：列号递增、月份在 1..12、列号在网格范围内', () => {
  const heat = yearHeat([], { today: TODAY });
  assert.ok(heat.monthLabels.length >= 10, `月份标签太少：${heat.monthLabels.length}`);
  let prev = -1;
  for (const label of heat.monthLabels) {
    assert.ok(label.col > prev, `列号未递增：${prev} → ${label.col}`);
    assert.ok(label.month >= 1 && label.month <= 12);
    assert.ok(label.col >= 0 && label.col < heat.grid.length);
    prev = label.col;
  }
});

/* ---------------- 11. 汇总统计 ---------------- */
await test('汇总统计：totalCount / totalDistanceM / max 与明细一致', () => {
  const rides = [
    ride('2026-05-01', 30000, 3600000),
    ride('2026-05-01', 20000, 2400000),
    ride('2026-05-08', 50000, 7200000),
  ];
  const heat = yearHeat(rides, { today: TODAY });
  assert.equal(heat.totalCount, 3);
  assert.equal(heat.activeDays, 2);
  assert.equal(heat.totalDistanceM, 100000);
  assert.equal(heat.max, 50000);
  assert.equal(cellMap(heat).get('2026-05-01').distanceM, 50000);
});

console.log(`\n${failed ? '✗ 失败' : '✓ 全部通过'}：${passed} 项通过，${failed} 项失败`);
process.exitCode = failed ? 1 : 0;
