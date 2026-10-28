// 展示用格式化（语言相关文案在 src/locales/*.json 的 format / month 段；用户数据本身不翻译）
import { t } from './i18n.js';

/** 月份名（1-12，取语言文件里的 month.N） */
function monthName(m) {
  return t('month.' + m);
}

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

/** 时长文案：整小时不显示「0 分」，整分不显示「0 秒」 */
export function durationText(ms) {
  if (ms == null) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    if (!m) return t('format.duration.h', { h });
    return t('format.duration.hm', { h, m });
  }
  if (m > 0) {
    if (!s) return t('format.duration.m', { m });
    return t('format.duration.ms', { m, s });
  }
  return t('format.duration.s', { s });
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

/** 本地化日期：zh「2026 年 1 月 5 日」/ en「Jan 5, 2026」 */
export function dateText(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return t('format.date', { y, m, d, mon: monthName(m) });
}

/** 本地化星期（按字符串里的日历日计算，避免 new Date('YYYY-MM-DD') 被当作 UTC 零点） */
export function weekdayText(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return t('format.weekday', { name: t('format.weekdays.' + day) });
}

/** 本地化月份标题：zh「2026 年 5 月」/ en「May 2026」 */
export function monthTitle(year, month) {
  return t('format.monthTitle', { y: year, m: month, mon: monthName(month) });
}

/**
 * 天气短语：原样展示三星导出里的文案，不做语言映射。
 * 这是用户数据（随导出包/手机语言而定），切换界面语言不应该改写它；
 * i18n 只用于界面 label、日期/时长等展示格式，不用于翻译数据内容。
 */
export function weatherText(phrase) {
  return String(phrase ?? '').trim();
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
