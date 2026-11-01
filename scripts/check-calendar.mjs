// 骑行日历「天视图」纯逻辑自检（node scripts/check-calendar.mjs）
//
// 为什么单独一个脚本：src/renderer/lib/calendar.js 刻意不依赖 i18n / vue / DOM，
// 就是为了能在 node 里直接跑；天视图的坑全在「跨周对齐 / 未来占位 / 分位数切档」
// 这些纯计算上，靠肉眼点界面看不出来，改动后必须跑这里。
//
// 测试数据全部虚构（只有日期、里程、时长这些自造数值），不含任何真实骑行记录、账号或本机路径。
import assert from 'node:assert/strict';
import { yearHeat, todayIso, DEFAULT_WEEKS, HEAT_LEVELS } from '../src/renderer/lib/calendar.js';

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
await test('常量：DEFAULT_WEEKS = 53、HEAT_LEVELS = 4', () => {
  assert.equal(DEFAULT_WEEKS, 53);
  assert.equal(HEAT_LEVELS, 4);
});

await test('默认网格：53 列 × 7 天 = 371 格，每列正好 7 天', () => {
  const heat = yearHeat([], { today: TODAY });
  assert.equal(heat.grid.length, 53);
  assert.equal(heat.grid.length, DEFAULT_WEEKS);
  for (const week of heat.grid) assert.equal(week.length, 7);
  assert.equal(allCells(heat).length, 371);
  assert.equal(heat.levels, HEAT_LEVELS);
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
await test('色阶：没骑行的天 level = 0', () => {
  for (const c of allCells(yearHeat([], { today: TODAY }))) assert.equal(c.level, 0);
});

await test('色阶：有骑行的天 level 至少 1（不会掉回 0）', () => {
  const heat = yearHeat([ride(TODAY, 12345), ride(shiftIso(TODAY, -100), 4000)], { today: TODAY });
  for (const c of allCells(heat)) {
    if (c.distanceM > 0) assert.ok(c.level >= 1, `${c.iso} 有里程却 level=${c.level}`);
    else assert.equal(c.level, 0);
  }
});

await test('色阶：所有骑行天里程都相同时落在最浅一档 1', () => {
  const heat = yearHeat(
    dailyRides('2026-03-01', 20, (start, i) => ride(shiftIso(start, i), 20000)),
    { today: TODAY },
  );
  assert.equal(heat.activeDays, 20);
  const levels = allCells(heat).filter((c) => c.distanceM > 0).map((c) => c.level);
  assert.deepEqual([...new Set(levels)], [1], `期望全为 1，实际 ${JSON.stringify(levels)}`);
});

await test('色阶：level 恒在 [0, levels] 区间内', () => {
  for (const lv of [1, 2, 4, 8]) {
    const heat = yearHeat(
      dailyRides('2026-03-01', 60, (start, i) => ride(shiftIso(start, i), 1000 * (i + 1))),
      { today: TODAY, levels: lv },
    );
    assert.equal(heat.levels, lv);
    for (const c of allCells(heat)) {
      assert.ok(Number.isInteger(c.level));
      assert.ok(c.level >= 0 && c.level <= lv, `${c.iso} level=${c.level} 越界（levels=${lv}）`);
    }
  }
});

await test('分位数切档：长尾分布下最远的一档 = levels，最近的一档 = 1', () => {
  // 1..100 km 各一天：最大值 100km 远超其余，若按线性切档会挤在最浅一档，
  // 这里断言分位数切档能让最高里程落满档、最低里程落 1 档。
  const start = '2026-03-01';
  const rides = dailyRides(start, 100, (s, i) => ride(shiftIso(s, i), 1000 * (i + 1)));
  const heat = yearHeat(rides, { today: TODAY });
  const cells = cellMap(heat);
  const lowest = cells.get(start);
  const highest = cells.get(shiftIso(start, 99));
  assert.equal(highest.distanceM, 100000);
  assert.equal(highest.level, heat.levels, `最高里程 level=${highest.level}，期望 ${heat.levels}`);
  assert.equal(lowest.distanceM, 1000);
  assert.equal(lowest.level, 1, `最低里程 level=${lowest.level}，期望 1`);
  assert.equal(heat.activeDays, 100);
  assert.equal(heat.thresholds.length, heat.levels - 1);
});

/* ---------------- 6. 闰年与跨年 ---------------- */
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
  // 没有可切档的数据时阈值仍保持 levels - 1 个槽位（全 0），
  // 这样调用方画色阶图例时不必判空；此时没有任何格子会拿到 >0 的 level。
  assert.equal(heat.thresholds.length, heat.levels - 1);
  assert.ok(heat.thresholds.every((t) => t === 0), `空数据阈值应为 0，实际 ${JSON.stringify(heat.thresholds)}`);
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
