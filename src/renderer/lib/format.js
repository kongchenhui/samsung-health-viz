// 展示用格式化
export function num(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US');
}

export function km(m, digits) {
  if (m == null) return '—';
  const v = m / 1000;
  const d = digits ?? (v >= 100 ? 1 : 2);
  return v.toFixed(d) + ' km';
}

export function speedKmh(mps, digits = 1) {
  if (mps == null) return '—';
  return (mps * 3.6).toFixed(digits) + ' km/h';
}

export function durationText(ms) {
  if (ms == null) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

export function clock(ms) {
  if (ms == null) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function dateCN(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

export function weekdayCN(iso) {
  const d = new Date(iso);
  return '周' + '日一二三四五六'[d.getDay()];
}

export function timeHM(iso) {
  return iso.slice(11, 16);
}

export function paceText(secPerKm) {
  if (!secPerKm || !Number.isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export function signed(n, digits = 0) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(digits);
}
