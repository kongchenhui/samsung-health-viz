// 轻量国际化：无依赖、响应式切换。
// 文案都在 src/locales/<locale>.json（一个语言一个文件），改文案不用动代码：
//   { "meta": { "name": "中文", "htmlLang": "zh-CN" }, "ui": { ...界面文案... }, "main": { ...主进程文案... } }
// 新增语言：复制一份 JSON，文件名就是 locale code（如 ja.json），meta.name 写语言自称；
// 主进程（main.mjs）读同一批文件里的 main 段，两个进程的语言列表自动一致。
//
// 用法：import { t, tPlural, i18n, setLocale } from './i18n.js';
//       模板里 {{ t('nav.career') }}；带参数 {{ t('career.subtitle', { count: 3 }) }}
// 回退链：当前语言 → 中文 → 英文 → fallback 参数 → key 本身。
import { reactive } from 'vue';

/* 构建期收集所有语言文件（Vite 静态分析，新增 JSON 自动生效） */
const files = import.meta.glob('../../locales/*.json', { eager: true, import: 'default' });

const messages = {};
const metas = {};
for (const [path, data] of Object.entries(files)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
  messages[code] = data.ui || {};
  metas[code] = data.meta || {};
}

/** 兜底语言（也是设置页里的排列顺序）：中文优先，其次英文，其余按代码排序 */
const FALLBACK_LOCALES = ['zh', 'en'];
const localeRank = (code) => {
  const i = FALLBACK_LOCALES.indexOf(code);
  return i === -1 ? FALLBACK_LOCALES.length : i;
};

export const LOCALE_CODES = Object.keys(messages).sort(
  (a, b) => localeRank(a) - localeRank(b) || a.localeCompare(b),
);

export const i18n = reactive({ locale: LOCALE_CODES.includes('zh') ? 'zh' : LOCALE_CODES[0] || 'zh' });

/** 语言的自称（设置页语言选项用），取自语言文件的 meta.name */
export function localeName(code) {
  return metas[code]?.name || code;
}

function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
}

/** 按回退链取一条文案；找不到返回 null */
function pick(key) {
  for (const code of [i18n.locale, ...FALLBACK_LOCALES]) {
    const s = lookup(messages[code], key);
    if (s != null) return s;
  }
  return null;
}

/**
 * 翻译。
 * @param {string} key 形如 'nav.career' 的点分 key
 * @param {Record<string, string|number>} [params] {name} 占位符参数
 * @param {string} [fallback] key 缺失时的兜底文案（如动态 reason 原文）
 */
export function t(key, params, fallback) {
  let s = pick(key);
  if (s == null) s = fallback != null ? fallback : key;
  if (params && typeof s === 'string') {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** 单复数：n === 1 时优先取 `${baseKey}_one`（缺失自动回退到 baseKey） */
export function tPlural(n, baseKey, params) {
  const hasOne = pick(`${baseKey}_one`) != null;
  return t(hasOne && Number(n) === 1 ? `${baseKey}_one` : baseKey, { n, ...(params || {}) });
}

/** 是否有某个 key 的译文（用于动态 reason 等场景） */
export function hasMessage(key) {
  return pick(key) != null;
}

/** 切换语言并同步 <html lang> */
export function setLocale(locale) {
  if (!messages[locale] || i18n.locale === locale) return;
  i18n.locale = locale;
  document.documentElement.lang = metas[locale]?.htmlLang || locale;
}
