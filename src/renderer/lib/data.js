// 从骑行数据集派生统计（纯函数，组件里用 computed 调用）
import { km, speedKmh, durationText } from './format.js';

export const YEAR_COLORS = { 2024: '#fbbf24', 2025: '#38bdf8', 2026: '#a78bfa' };
export const FALLBACK_COLOR = '#94a3b8';

export function yearColor(date) {
  return YEAR_COLORS[Number(date.slice(0, 4))] || FALLBACK_COLOR;
}

export function rideTooltipHtml(r) {
  const parts = [
    `<b>${r.date.slice(0, 10)}</b> ${r.start.slice(11, 16)}`,
    `${km(r.distanceM)} · ${durationText(r.durationMs)}`,
  ];
  if (r.avgSpeedMps) parts.push(`均速 ${speedKmh(r.avgSpeedMps)}`);
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
  const fastest = pick(
    valid.filter((r) => r.durationMs > 600000),
    (r) => r.avgSpeedMps || 0
  );
  const climb = pick(valid, (r) => r.elevGainM || 0);
  const burn = pick(valid, (r) => r.calories || 0);
  return [
    { key: 'distance', label: '最长单次距离', value: km(longest.distanceM), ride: longest },
    { key: 'duration', label: '最长骑行时间', value: durationText(longestTime.durationMs), ride: longestTime },
    { key: 'speed', label: '最快平均速度', value: speedKmh(fastest.avgSpeedMps), ride: fastest },
    { key: 'climb', label: '最大累计爬升', value: `${Math.round(climb.elevGainM || 0)} m`, ride: climb },
    { key: 'calories', label: '单次最大消耗', value: `${Math.round(burn.calories || 0)} kcal`, ride: burn },
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
  const max = Math.max(1, ...rows.flatMap((r) => r.months.map((m) => m.distanceM)));
  return { rows, max };
}

export function rideSplits(ride) {
  return (ride.splits || []).map((s) => ({
    km: s.km,
    sec: s.sec,
    pace: s.sec, // 秒/公里
  }));
}
