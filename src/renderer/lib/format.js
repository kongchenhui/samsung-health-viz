// 展示用格式化（语言相关文案在 src/locales/*.json 的 format / month / weather 段）
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

// 天气短语来自三星导出（随导出语言变化），这里只映射常见值，未知原样展示
const WEATHER_PHRASES = {
  晴: 'clear',
  晴朗: 'clear',
  clear: 'clear',
  sunny: 'clear',
  多云: 'partlyCloudy',
  局部多云: 'partlyCloudy',
  'partly cloudy': 'partlyCloudy',
  阴: 'cloudy',
  阴天: 'cloudy',
  cloudy: 'cloudy',
  overcast: 'cloudy',
  小雨: 'lightRain',
  阵雨: 'lightRain',
  'light rain': 'lightRain',
  drizzle: 'lightRain',
  中雨: 'rain',
  rain: 'rain',
  大雨: 'heavyRain',
  暴雨: 'heavyRain',
  'heavy rain': 'heavyRain',
  雷阵雨: 'thunderstorm',
  雷雨: 'thunderstorm',
  thunderstorm: 'thunderstorm',
  雨夹雪: 'sleet',
  sleet: 'sleet',
  小雪: 'lightSnow',
  'light snow': 'lightSnow',
  snow: 'snow',
  中雪: 'snow',
  大雪: 'heavySnow',
  'heavy snow': 'heavySnow',
  雾: 'fog',
  fog: 'fog',
  mist: 'mist',
  霾: 'haze',
  haze: 'haze',
  沙尘: 'haze',
  大风: 'windy',
  windy: 'windy',
};

/** 天气短语本地化：命中映射返回当前语言文案，未知短语原样返回 */
export function weatherText(phrase) {
  const raw = String(phrase ?? '').trim();
  if (!raw) return '';
  const key = WEATHER_PHRASES[raw] || WEATHER_PHRASES[raw.toLowerCase()];
  return key ? t('weather.' + key) : raw;
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
