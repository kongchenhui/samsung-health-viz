// 从骑行数据集派生统计（纯函数，组件里用 computed 调用）
import { km, speedKmh, durationText } from './format.js';
import { t } from './i18n.js';
import { scaleCeiling } from './calendar.js';

// 年份色：明暗主题共用同一套亮色（地图轨迹、图例、柱状图统一）
//
// 年份是开放集合（数据包可能含任意年份），所以不按具体年份建映射，
// 而是按年份在当前数据集里的**升序下标**从调色板取色：
// 任意跨度都能得到可区分的颜色，未登记的年份也不会退化成一个「像失效」的灰。
//
// 代价：同一年的颜色会随数据范围变化，所以不要在此基础上做「跨会话记住某年颜色」的功能。
//
// 调色板说明：取 Tailwind 400 色阶（与既有界面配色同源），沿色相环按最大间隔铺开，
// 8 色是区分度与观感的平衡点——再多就会出现相邻年份颜色难辨的情况。
// 全部为亮色（深浅主题通用，遵守「数据色两套主题共用」的约定）。
export const YEAR_PALETTE = [
  '#fbbf24', // amber-400   43°
  '#38bdf8', // sky-400    198°
  '#a78bfa', // violet-400 255°
  '#86efac', // green-300  142°
  '#a3e635', // lime-400    83°
  '#2dd4bf', // teal-400   172°
  '#f472b6', // pink-400   329°
  '#e879f9', // fuchsia-400 292°
];
// 兜底：只在拿不到年份集合时使用（例如传入非法 date 或年份未登记）
export const FALLBACK_COLOR = '#94a3b8';

/* 当前数据集的年份集合（升序）。由 store 在数据集变化时登记一次，
 * 让 yearColor(date) 保持单参数签名，既有调用点无需改动。 */
let knownYears = [];

/** 登记当前数据集的年份集合（任意顺序，内部去重并升序）；返回整理后的数组 */
export function setKnownYears(years) {
  const list = [...new Set((years || []).map(Number).filter((y) => Number.isFinite(y)))].sort((a, b) => a - b);
  knownYears = list;
  return list;
}

function colorForYear(year) {
  const idx = knownYears.indexOf(year);
  if (idx === -1) return FALLBACK_COLOR;
  return YEAR_PALETTE[idx % YEAR_PALETTE.length];
}

export function yearColor(date) {
  if (!date) return FALLBACK_COLOR;
  return colorForYear(Number(String(date).slice(0, 4)));
}

export function rideTooltipHtml(r) {
  const parts = [
    `<b>${r.date.slice(0, 10)}</b> ${r.start.slice(11, 16)}`,
    `${km(r.distanceM)} · ${durationText(r.durationMs)}`,
  ];
  if (r.avgSpeedMps) parts.push(`${t('map.avgSpeed')} ${speedKmh(r.avgSpeedMps)}`);
  return `<div class="map-tip-inner">${parts.join('<br/>')}</div>`;
}

export function careerStats(rides) {
  const list = rides.filter((r) => r.distanceM > 0);
  const distanceM = list.reduce((s, r) => s + r.distanceM, 0);
  const durationMs = rides.reduce((s, r) => s + (r.durationMs || 0), 0);
  const calories = rides.reduce((s, r) => s + (r.calories || 0), 0);
  const gainM = rides.reduce((s, r) => s + (r.elevGainM || 0), 0);
  const tracks = rides.filter((r) => r.hasTrack).length;
  return {
    count: rides.length,
    tracks,
    distanceM,
    durationMs,
    calories,
    gainM,
    avgSpeedMps: durationMs ? distanceM / (durationMs / 1000) : null,
    first: rides[0]?.date || null,
    last: rides[rides.length - 1]?.date || null,
    years: [...new Set(rides.map((r) => Number(r.date.slice(0, 4))))].sort(),
  };
}

export function yearStats(rides) {
  const map = new Map();
  for (const r of rides) {
    const y = Number(r.date.slice(0, 4));
    const cur = map.get(y) || { year: y, count: 0, distanceM: 0, durationMs: 0, gainM: 0 };
    cur.count += 1;
    cur.distanceM += r.distanceM || 0;
    cur.durationMs += r.durationMs || 0;
    cur.gainM += r.elevGainM || 0;
    map.set(y, cur);
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}

export function personalBests(rides) {
  const valid = rides.filter((r) => r.distanceM > 0);
  const pick = (arr, fn) => arr.reduce((best, r) => (fn(r) > fn(best) ? r : best), arr[0]);
  if (!valid.length) return [];
  const longest = pick(valid, (r) => r.distanceM);
  const longestTime = pick(valid, (r) => r.durationMs || 0);
  // 速度榜只统计 10 分钟以上骑行；全短途时回退到全部有效骑行，避免空数组 pick 出 undefined 后崩溃
  const longRides = valid.filter((r) => (r.durationMs || 0) > 600000);
  const fastest = pick(longRides.length ? longRides : valid, (r) => r.avgSpeedMps || 0);
  const climb = pick(valid, (r) => r.elevGainM || 0);
  const burn = pick(valid, (r) => r.calories || 0);
  return [
    { key: 'distance', label: t('pb.distance'), value: km(longest.distanceM), ride: longest },
    { key: 'duration', label: t('pb.duration'), value: durationText(longestTime.durationMs), ride: longestTime },
    {
      key: 'speed',
      label: t('pb.speed'),
      value: fastest.avgSpeedMps ? speedKmh(fastest.avgSpeedMps) : '—',
      ride: fastest,
    },
    { key: 'climb', label: t('pb.climb'), value: `${Math.round(climb.elevGainM || 0)} m`, ride: climb },
    { key: 'calories', label: t('pb.calories'), value: `${Math.round(burn.calories || 0)} kcal`, ride: burn },
  ];
}

export function monthHeat(rides) {
  const map = new Map();
  for (const r of rides) {
    const key = r.date.slice(0, 7);
    const cur = map.get(key) || { distanceM: 0, count: 0 };
    cur.distanceM += r.distanceM || 0;
    cur.count += 1;
    map.set(key, cur);
  }
  const years = [...new Set(rides.map((r) => Number(r.date.slice(0, 4))))].sort();
  const rows = years.map((year) => ({
    year,
    months: Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const v = map.get(key);
      return { key, month: i + 1, distanceM: v?.distanceM || 0, count: v?.count || 0 };
    }),
  }));
  // 归一化上限与日视图同一套规则：取当前数据集的最大值
  const max = scaleCeiling(rows.flatMap((r) => r.months.map((m) => m.distanceM)));
  return { rows, max };
}

export function rideSplits(ride) {
  return (ride.splits || []).map((s) => ({
    km: s.km,
    sec: s.sec,
    pace: s.sec, // 秒/公里
  }));
}
