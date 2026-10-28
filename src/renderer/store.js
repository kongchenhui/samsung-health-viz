// 全局状态与动作（不引入 pinia，首期够用）
import { reactive, watch } from 'vue';
import { requiresStadiaKey, TILES } from './lib/leaflet.js';
import { LOCALE_CODES, setLocale, t, hasMessage } from './lib/i18n.js';
import { pairedStyleFor } from './lib/theme-map.js';

// 地图偏好 / 界面主题 / 语言 持久化到本地配置文件：<userData>/settings.json
const DEFAULT_MAP_STYLE = 'amap-dark';
const DEFAULT_MAP_DIM = 18;
// 主题模式：system 跟随系统深浅色，dark / light 为用户手动指定
const THEME_MODES = ['system', 'dark', 'light'];
const STADIA_ENV_KEY = (import.meta.env.VITE_STADIA_API_KEY || '').trim();
const lightQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export const store = reactive({
  ready: false,
  platform: '',
  info: null,
  dataset: null,
  mapStyle: DEFAULT_MAP_STYLE,
  mapDim: DEFAULT_MAP_DIM, // 底图淡化（0-100），让轨迹更突出
  mapStyleAuto: true, // 「底图跟随主题」：由用户在设置页显式开关，不做任何自动推断
  yearFilter: 'all',
  stadiaKey: STADIA_ENV_KEY,
  themeMode: 'system', // 用户偏好：'system' | 'dark' | 'light'
  theme: 'dark', // 实际生效的主题：'dark' | 'light'（由 themeMode 推导，图表配色读这个）
  locale: 'zh', // 语言代码，见 src/locales/
  // 需要 API Key 的底图：{ visible, style, fallback }，由 StadiaKeyDialog 渲染
  stadiaKeyDialog: { visible: false, style: '', fallback: '' },
});

// 偏好写盘：启动阶段（含 URL 调试参数）不写，避免把临时值固化；滑杆连续拖动做轻量防抖。
// 底图 Key 无值时 Stadia 底图会被 boot() 回退，回退结果同样不写入，下次有 Key 时仍能恢复原选择。
let prefsTimer = null;
/** 偏好写盘（滑杆连续拖动做 250ms 防抖，其余立即写） */
function saveMapPrefs(immediate = false) {
  if (!store.ready) return;
  clearTimeout(prefsTimer);
  const write = () => {
    prefsTimer = null;
    try {
      const p = window.api.savePrefs({
        mapStyle: store.mapStyle,
        mapDim: Math.round(store.mapDim),
        stadiaKey: store.stadiaKey,
        mapStyleAuto: store.mapStyleAuto,
        theme: store.themeMode,
        locale: store.locale,
      });
      if (p?.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  };
  if (immediate) write();
  else prefsTimer = setTimeout(write, 250);
}
watch(
  () => store.mapStyle,
  () => saveMapPrefs()
);
watch(
  () => store.mapDim,
  () => saveMapPrefs()
);
// Key 变更频率低，直接落盘
watch(
  () => store.stadiaKey,
  () => saveMapPrefs(true)
);
// 退出前把防抖队列里还没落盘的偏好补上
window.addEventListener('beforeunload', () => {
  if (prefsTimer) saveMapPrefs(true);
});

export const progress = reactive({ visible: false, message: '', percent: 0 });
export const toast = reactive({ visible: false, message: '', type: 'info', timer: null });

export function showProgress(message, percent = 0) {
  progress.visible = true;
  progress.message = message;
  progress.percent = Math.max(0, Math.min(100, percent));
}

export function hideProgress() {
  progress.visible = false;
}

let toastTimer = null;
export function showToast(message, type = 'info', ms = 2600) {
  toast.message = message;
  toast.type = type;
  toast.visible = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.visible = false), ms);
}

/* ---------------- 界面主题与语言 ---------------- */

/** 系统当前深浅色 */
function systemTheme() {
  return lightQuery?.matches ? 'light' : 'dark';
}

/** 由 themeMode 推导实际生效的主题，并写到 <body>（styles.css 用 body.theme-light 覆盖变量） */
function applyTheme() {
  store.theme = store.themeMode === 'system' ? systemTheme() : store.themeMode;
  document.body.classList.toggle('theme-light', store.theme === 'light');
}

/** 生效主题变化后联动底图明暗（prev 为变化前的生效主题） */
function syncMapStyleWithTheme(prevTheme) {
  if (prevTheme === store.theme) return;
  // 只有「由主题自动挑选」的底图才联动，用户手动选过的保持不动
  if (!store.mapStyleAuto) return;
  const swap = pairedStyleFor(store.theme, store.mapStyle);
  if (swap) setMapStyle(swap, { fromTheme: true });
}

/**
 * 启动时对齐一次底图：系统外观可能在应用关闭期间变过，而底图样式是上次会话落盘的。
 * 只处理「由主题自动选择」的底图（mapStyleAuto），用户手动选过的保持不动。
 */
function alignMapStyleOnBoot() {
  if (!store.mapStyleAuto) return;
  const swap = pairedStyleFor(store.theme, store.mapStyle);
  // 启动阶段不弹 Key 对话框：目标底图缺 Key 就先保持现状
  if (!swap || (requiresStadiaKey(swap) && !store.stadiaKey)) return;
  store.mapStyle = swap;
}

/**
 * 设置主题模式：'system' 跟随系统 / 'dark' 深色 / 'light' 浅色。
 * 切换后立即生效并落盘。
 */
export function setThemeMode(mode) {
  if (!THEME_MODES.includes(mode) || mode === store.themeMode) return;
  const prev = store.theme;
  store.themeMode = mode;
  applyTheme();
  syncMapStyleWithTheme(prev);
  // 通知主进程（原生标题栏 / 原生主题跟随；preload 未加载时静默忽略）
  window.api?.applyTheme?.(store.themeMode);
  saveMapPrefs(true);
}

/** 在 系统 → 浅色 → 深色 → 系统 之间循环（标题栏按钮用） */
export function cycleThemeMode() {
  const i = THEME_MODES.indexOf(store.themeMode);
  setThemeMode(THEME_MODES[(i + 1) % THEME_MODES.length]);
}

// 系统深浅色变化时，只有「跟随系统」模式下才跟着变（不写盘，偏好仍是 system）
lightQuery?.addEventListener?.('change', () => {
  if (store.themeMode !== 'system') return;
  const prev = store.theme;
  applyTheme();
  syncMapStyleWithTheme(prev);
});

// 模块加载先消费 preload 同步读出的初始偏好（磁盘值），再应用一次主题/语言：
// 这样首帧就是正确的主题与语言，不会先闪一下默认深色/中文（boot 稍后仍以磁盘为准）。
const initialPrefs = window.api?.initialPrefs;
if (initialPrefs && typeof initialPrefs === 'object') {
  if (THEME_MODES.includes(initialPrefs.theme)) store.themeMode = initialPrefs.theme;
  if (LOCALE_CODES.includes(initialPrefs.locale)) {
    store.locale = initialPrefs.locale;
    setLocale(initialPrefs.locale);
  }
}
applyTheme();

/** 切换语言（'zh' | 'en'） */
export function setAppLocale(locale) {
  if (!LOCALE_CODES.includes(locale)) return;
  setLocale(locale);
  store.locale = locale;
  // 通知主进程（原生菜单 / 对话框文案；preload 未加载时静默忽略）
  window.api?.applyLocale?.(locale);
  saveMapPrefs(true);
}

/* ---------------- 地图底图：Stadia API Key ---------------- */

/** 底图是否支持明暗成对（高德暗/标准、Stadia Alidade Smooth Dark/Smooth） */
export function styleHasPair(style) {
  return !!(pairedStyleFor('light', style) || pairedStyleFor('dark', style));
}

/**
 * 开启/关闭「底图跟随主题」——纯用户配置，不做推断。
 * 开启时只按当前主题对齐一次「成对」底图；没有明暗版本的底图保持不动
 * （设置页会明确提示它不会随主题变化）。
 */
export function setMapStyleAuto(enabled) {
  store.mapStyleAuto = !!enabled;
  if (store.mapStyleAuto) {
    const swap = pairedStyleFor(store.theme, store.mapStyle);
    if (swap) setMapStyle(swap, { fromTheme: true });
  }
  saveMapPrefs(true);
}

/**
 * 切换底图；选到需要 Key 的 Stadia 底图但还没配置时，弹出 Key 输入框。
 * fromTheme=true 表示由主题联动选择（保持「跟随主题」开启）；
 * 用户在底图下拉里手动选择则关闭「跟随主题」，之后主题变化不再改底图。
 */
export function setMapStyle(style, { fromTheme = false } = {}) {
  if (!style || style === store.mapStyle) return;
  const fallback = store.mapStyle;
  store.mapStyle = style;
  store.mapStyleAuto = fromTheme;
  if (requiresStadiaKey(style) && !store.stadiaKey) {
    store.stadiaKeyDialog = { visible: true, style, fallback };
  }
}

/** 手动打开 Key 输入框（「数据」页配置/更换 Key 用） */
export function openStadiaKeyDialog(style = store.mapStyle) {
  store.stadiaKeyDialog = { visible: true, style, fallback: '' };
}

export function cancelStadiaKeyDialog() {
  const { fallback } = store.stadiaKeyDialog;
  store.stadiaKeyDialog = { visible: false, style: '', fallback: '' };
  // 从底图下拉框触发时，取消后回到原来的底图
  if (fallback) store.mapStyle = fallback;
}

/**
 * 保存 / 清空 Stadia API Key。
 * silent=true 时由调用方负责提示（clearStadiaKey 需要合并成一条 toast，避免互相覆盖）。
 * @returns {boolean} 是否因清空 Key 而把底图回退成了默认底图
 */
export function saveStadiaKey(raw, { silent = false } = {}) {
  const key = String(raw ?? '').trim();
  // 写入本地配置文件（由 stadiaKey 的 watcher 落盘）
  store.stadiaKey = key || STADIA_ENV_KEY;
  const { fallback } = store.stadiaKeyDialog;
  store.stadiaKeyDialog = { visible: false, style: '', fallback: '' };

  if (!store.stadiaKey && requiresStadiaKey(store.mapStyle)) {
    // 清空 Key 时不要留下空底图，回退也要跟随当前主题
    store.mapStyle = fallback || (store.theme === 'light' ? 'amap' : 'amap-dark');
    if (!silent) showToast(t('toast.noStadiaKey'), 'info', 4200);
    return true;
  }
  if (key && !silent) showToast(t('toast.stadiaKeySaved'), 'success');
  return false;
}

/** 清除本机保存的 Key（若构建时注入了 VITE_STADIA_API_KEY，会回退到它） */
export function clearStadiaKey() {
  const fellBack = saveStadiaKey('', { silent: true });
  if (fellBack) showToast(t('toast.noStadiaKey'), 'info', 4200);
  else showToast(store.stadiaKey ? t('toast.clearedKeyFallback') : t('toast.clearedKey'));
}

export function setDataset(data) {
  store.dataset = data;
  store.yearFilter = 'all';
  location.hash = '#/career';
}

export async function boot() {
  try {
    const info = await window.api.info();
    store.info = info;
    store.platform = info.platform;
    document.body.classList.add('platform-' + info.platform);
  } catch (e) {
    console.error('info failed', e);
  }

  // 读取本地配置文件里的偏好（地图 / 主题 / 语言 / 跟随主题）；无效值忽略。
  // 这里不做任何推断：缺省值用固定默认，用户没配过的项保持默认，等用户去设置页配置。
  try {
    const prefs = await window.api.loadPrefs();
    const data = prefs?.data;
    if (data && typeof data === 'object') {
      if (typeof data.mapStyle === 'string' && data.mapStyle && TILES[data.mapStyle]) {
        store.mapStyle = data.mapStyle;
      }
      const dim = Number(data.mapDim);
      if (data.mapDim !== null && data.mapDim !== '' && Number.isFinite(dim)) {
        store.mapDim = Math.max(0, Math.min(100, dim));
      }
      if (typeof data.stadiaKey === 'string') {
        store.stadiaKey = data.stadiaKey.trim() || STADIA_ENV_KEY;
      }
      // 「底图跟随主题」只认用户保存过的开关值；老配置没有该字段就用默认（开启），不猜测
      if (typeof data.mapStyleAuto === 'boolean') store.mapStyleAuto = data.mapStyleAuto;
      // 主题：保存的是模式（system/dark/light），缺失或非法时默认跟随系统
      if (THEME_MODES.includes(data.theme)) {
        store.themeMode = data.theme;
      }
      // 语言：只认用户保存过的值，不按系统语言推断
      if (LOCALE_CODES.includes(data.locale)) {
        store.locale = data.locale;
        setLocale(data.locale);
      }
    }
  } catch (e) {
    console.error('load prefs failed', e);
  }
  applyTheme();

  // 支持 URL 参数调试/深链：?map=amap-dark&dim=40（只对本次启动生效，不写回文件）
  const params = new URLSearchParams(location.search);
  const mapParam = params.get('map');
  if (mapParam && TILES[mapParam]) {
    store.mapStyle = mapParam;
    store.mapStyleAuto = false; // 显式指定，不再被主题覆盖
  }
  const dimRaw = params.get('dim');
  const dimParam = Number(dimRaw);
  if (dimRaw !== null && dimRaw !== '' && Number.isFinite(dimParam)) {
    store.mapDim = Math.max(0, Math.min(100, dimParam));
  }
  // 深链/配置指定了需要 Key 的底图但本机还没配置 Key：回退，避免打开就是空地图
  if (requiresStadiaKey(store.mapStyle) && !store.stadiaKey) {
    store.mapStyle = store.theme === 'light' ? 'amap' : 'amap-dark';
  }
  // 系统外观可能在应用关闭期间变过：启动时把主题自动选的底图对齐一次
  alignMapStyleOnBoot();

  const cached = await window.api.loadCached();
  if (cached?.ok) {
    store.dataset = cached.data;
  } else {
    const startup = await window.api.startup();
    if (startup?.ok) store.dataset = startup.data;
  }
  store.ready = true;
}

export async function parseTarget(target) {
  if (!target) return;
  showProgress(t('toast.reading'), 2);
  const off = window.api.onProgress(({ message, percent }) => showProgress(message, percent));
  try {
    const res = await window.api.parse(target);
    if (!res.ok) throw new Error(res.error || t('toast.parseFailed'));
    setDataset(res.data);
    showToast(t('toast.parsed', { n: res.data.meta.ridesTotal }), 'success');
  } catch (e) {
    showToast(t('toast.parseFailedWith', { error: e.message || e }), 'error', 5000);
  } finally {
    off?.();
    hideProgress();
  }
}

export async function pickZip() {
  const res = await window.api.pickZip(store.locale);
  if (res.ok && res.path) await parseTarget(res.path);
}

export async function pickFolder() {
  const res = await window.api.pickFolder(store.locale);
  if (res.ok && res.path) await parseTarget(res.path);
}

/* ---------------- 手机 → 电脑 局域网直传 ---------------- */

export const lan = reactive({
  running: false,
  starting: false,
  stopping: false,
  port: null,
  token: '',
  urls: [],
  uploadDir: '',
  phase: 'idle', // idle | receiving | parsing | done | error
  uploadName: '',
  receivedBytes: 0,
  startedAt: 0,
  error: '',
  lastUpload: null,
});

function applyLanInfo(info) {
  if (!info) return;
  lan.running = !!info.running;
  if (info.port) lan.port = info.port;
  if (info.token) lan.token = info.token;
  if (Array.isArray(info.urls)) lan.urls = info.urls;
  if (info.uploadDir) lan.uploadDir = info.uploadDir;
  if (info.lastUpload) lan.lastUpload = info.lastUpload;
}

export async function refreshLanStatus() {
  try {
    const res = await window.api.lanStatus();
    if (res?.ok) applyLanInfo(res);
  } catch { /* ignore */ }
}

export async function lanEnable() {
  if (lan.starting || lan.running) return;
  lan.starting = true;
  lan.error = '';
  try {
    const res = await window.api.lanStart();
    if (!res.ok) throw new Error(res.error || t('toast.parseFailed'));
    applyLanInfo(res);
    lan.phase = 'idle';
    showToast(t('toast.lanStarted'), 'success', 4500);
  } catch (e) {
    lan.error = e.message || String(e);
    showToast(t('toast.lanStartFailed', { error: lan.error }), 'error', 5000);
  } finally {
    lan.starting = false;
  }
}

export async function lanDisable() {
  lan.stopping = true;
  try {
    await window.api.lanStop();
  } finally {
    lan.stopping = false;
    lan.running = false;
    lan.phase = 'idle';
    lan.receivedBytes = 0;
  }
}

export async function lanRegenerateToken() {
  const res = await window.api.lanToken();
  if (res?.ok && res.token) {
    lan.token = res.token;
    showToast(t('toast.tokenRegenerated'), 'success');
  }
}

export async function lanClearFiles() {
  await window.api.lanClear();
  lan.lastUpload = null;
  lan.phase = 'idle';
}

export function lanCopy(text) {
  if (!text) return;
  window.api.copyText(text);
  showToast(t('toast.copied', { text }), 'success', 2200);
}

/** 上传被拒原因 → 本地化文案（未知 reason 保留原文） */
function whyText(reason) {
  const key = 'data.lan.why.' + reason;
  return hasMessage(key) ? t(key) : reason || t('toast.uploadRejected');
}

export function setupLanEvents() {
  const offState = window.api.onLanState((ev) => {
    if (!ev || !ev.type) return;
    if (ev.type === 'listening') {
      applyLanInfo({ ...ev, running: true });
    } else if (ev.type === 'token') {
      lan.token = ev.token || lan.token;
    } else if (ev.type === 'upload-start') {
      lan.phase = 'receiving';
      lan.uploadName = ev.name || '';
      lan.receivedBytes = 0;
      lan.startedAt = Date.now();
      lan.error = '';
    } else if (ev.type === 'upload-progress') {
      lan.phase = 'receiving';
      lan.receivedBytes = Math.max(0, Number(ev.bytes) || 0);
    } else if (ev.type === 'upload-saved') {
      lan.phase = 'parsing';
      lan.receivedBytes = Number(ev.bytes) || lan.receivedBytes;
      lan.lastUpload = {
        name: ev.name,
        bytes: ev.bytes,
        receiveMs: ev.receiveMs,
        at: Date.now(),
      };
      showProgress(t('toast.lanParsing'), 2);
    } else if (ev.type === 'parsing') {
      lan.phase = 'parsing';
    } else if (ev.type === 'parsed') {
      lan.phase = 'done';
      lan.lastUpload = {
        name: ev.name,
        bytes: ev.bytes,
        receiveMs: ev.receiveMs,
        parseMs: ev.data?.meta?.parseMs,
        at: Date.now(),
      };
      hideProgress();
      const data = ev.data;
      if (data) {
        const first = !store.dataset;
        if (first) setDataset(data);
        else {
          store.dataset = data;
          store.yearFilter = 'all';
        }
        showToast(t('toast.lanParsed', { n: data.meta?.ridesTotal ?? '?' }), 'success', 4200);
      } else {
        showToast(t('toast.lanParsedPlain'), 'success');
      }
    } else if (ev.type === 'parse-error') {
      lan.phase = 'error';
      lan.error = ev.error || t('toast.parseErrorPlain');
      hideProgress();
      showToast(t('toast.lanParseFailed', { error: lan.error }), 'error', 6000);
    } else if (ev.type === 'upload-rejected') {
      lan.phase = 'error';
      lan.error = whyText(ev.reason);
      showToast(t('toast.lanUploadRejected', { error: lan.error }), 'error', 5000);
      hideProgress();
    } else if (ev.type === 'error') {
      lan.error = ev.message || t('toast.receiveError');
      showToast(t('toast.lanReceiveError', { error: lan.error }), 'error', 5000);
      hideProgress();
    } else if (ev.type === 'stopped') {
      lan.running = false;
      lan.phase = 'idle';
    } else if (ev.type === 'cleared') {
      lan.lastUpload = null;
    }
  });
  const offProgress = window.api.onProgress(({ message, percent }) => {
    if (lan.phase === 'parsing') showProgress(message, percent);
  });
  return () => {
    offState?.();
    offProgress?.();
  };
}

/* ---------------- 多窗口同步（主窗口 ↔ 独立设置窗口） ---------------- */

/**
 * 应用来自另一窗口的偏好变更（不写盘，避免多窗口互相触发回环）。
 * 主题变化时同步联动底图（仍受「底图跟随主题」开关约束）。
 */
export function applyExternalPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;
  if (THEME_MODES.includes(prefs.theme) && prefs.theme !== store.themeMode) {
    const prev = store.theme;
    store.themeMode = prefs.theme;
    applyTheme();
    syncMapStyleWithTheme(prev);
  }
  if (LOCALE_CODES.includes(prefs.locale) && prefs.locale !== store.locale) {
    store.locale = prefs.locale;
    setLocale(prefs.locale);
  }
  if (typeof prefs.mapStyleAuto === 'boolean') store.mapStyleAuto = prefs.mapStyleAuto;
  if (typeof prefs.mapStyle === 'string' && TILES[prefs.mapStyle]) store.mapStyle = prefs.mapStyle;
  const dim = Number(prefs.mapDim);
  if (prefs.mapDim !== null && prefs.mapDim !== undefined && Number.isFinite(dim)) {
    store.mapDim = Math.max(0, Math.min(100, dim));
  }
  if (typeof prefs.stadiaKey === 'string') store.stadiaKey = prefs.stadiaKey.trim() || STADIA_ENV_KEY;
}

/** 另一窗口重新解析 / 清除了数据包：刷新本窗口的数据集 */
export async function refreshDataset() {
  try {
    const cached = await window.api.loadCached();
    store.dataset = cached?.ok ? cached.data : null;
    if (!store.dataset) store.yearFilter = 'all';
  } catch (e) {
    console.error('refresh dataset failed', e);
  }
}

/**
 * 订阅主进程广播：偏好变更（主题 / 语言 / 底图）与数据变更。
 * 主窗口与设置窗口都会调用；返回取消订阅函数。
 */
export function setupCrossWindowSync() {
  const offPrefs = window.api.onPrefsChanged?.((prefs) => applyExternalPrefs(prefs));
  const offData = window.api.onDataChanged?.(() => {
    refreshDataset();
  });
  return () => {
    offPrefs?.();
    offData?.();
  };
}

