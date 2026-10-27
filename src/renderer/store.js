// 全局状态与动作（不引入 pinia，首期够用）
import { reactive, watch } from 'vue';
import { requiresStadiaKey, TILES } from './lib/leaflet.js';

// 地图偏好（底图主题 / 淡化 / Stadia API Key）持久化到本地配置文件：<userData>/settings.json
const DEFAULT_MAP_STYLE = 'amap-dark';
const DEFAULT_MAP_DIM = 18;
const STADIA_ENV_KEY = (import.meta.env.VITE_STADIA_API_KEY || '').trim();

export const store = reactive({
  ready: false,
  platform: '',
  info: null,
  dataset: null,
  mapStyle: DEFAULT_MAP_STYLE,
  mapDim: DEFAULT_MAP_DIM, // 底图淡化（0-100），让轨迹更突出
  yearFilter: 'all',
  stadiaKey: STADIA_ENV_KEY,
  // 需要 API Key 的底图：{ visible, style, fallback }，由 StadiaKeyDialog 渲染
  stadiaKeyDialog: { visible: false, style: '', fallback: '' },
});

// 偏好写盘：启动阶段（含 URL 调试参数）不写，避免把临时值固化；滑杆连续拖动做轻量防抖。
// 底图 Key 无值时 Stadia 底图会被 boot() 回退，回退结果同样不写入，下次有 Key 时仍能恢复原选择。
let prefsTimer = null;
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

/* ---------------- 地图底图：Stadia API Key ---------------- */

/** 切换底图；选到需要 Key 的 Stadia 底图但还没配置时，弹出 Key 输入框 */
export function setMapStyle(style) {
  if (!style || style === store.mapStyle) return;
  const fallback = store.mapStyle;
  store.mapStyle = style;
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

export function saveStadiaKey(raw) {
  const key = String(raw ?? '').trim();
  // 写入本地配置文件（由 stadiaKey 的 watcher 落盘）
  store.stadiaKey = key || STADIA_ENV_KEY;
  const { fallback } = store.stadiaKeyDialog;
  store.stadiaKeyDialog = { visible: false, style: '', fallback: '' };

  if (!store.stadiaKey && requiresStadiaKey(store.mapStyle)) {
    // 清空 Key 时不要留下空底图
    store.mapStyle = fallback || 'amap-dark';
    showToast('未填写 Stadia API Key，已切回「高德 · 暗色」', 'info', 4200);
  } else if (key) {
    showToast('Stadia API Key 已保存，正在加载底图', 'success');
  }
}

/** 清除本机保存的 Key（若构建时注入了 VITE_STADIA_API_KEY，会回退到它） */
export function clearStadiaKey() {
  saveStadiaKey('');
  showToast(store.stadiaKey ? '已清除本机 Key，回退到构建配置的 Key' : '已清除本机保存的 Stadia Key');
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

  // 读取本地配置文件里的地图偏好（底图主题 / 淡化 / Stadia Key），无效值直接忽略
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
    }
  } catch (e) {
    console.error('load prefs failed', e);
  }

  // 支持 URL 参数调试/深链：?map=amap-dark&dim=40（只对本次启动生效，不写回文件）
  const params = new URLSearchParams(location.search);
  if (params.get('map')) store.mapStyle = params.get('map');
  if (params.get('dim') !== null && params.get('dim') !== '') store.mapDim = Number(params.get('dim'));
  // 深链/配置指定了需要 Key 的底图但本机还没配置 Key：回退，避免打开就是空地图
  if (requiresStadiaKey(store.mapStyle) && !store.stadiaKey) store.mapStyle = 'amap-dark';

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
  showProgress('读取数据包…', 2);
  const off = window.api.onProgress(({ message, percent }) => showProgress(message, percent));
  try {
    const res = await window.api.parse(target);
    if (!res.ok) throw new Error(res.error || '解析失败');
    setDataset(res.data);
    showToast(`已解析 ${res.data.meta.ridesTotal} 条骑行记录`, 'success');
  } catch (e) {
    showToast('解析失败：' + (e.message || e), 'error', 5000);
  } finally {
    off?.();
    hideProgress();
  }
}

export async function pickZip() {
  const res = await window.api.pickZip();
  if (res.ok && res.path) await parseTarget(res.path);
}

export async function pickFolder() {
  const res = await window.api.pickFolder();
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
    if (!res.ok) throw new Error(res.error || '启动失败');
    applyLanInfo(res);
    lan.phase = 'idle';
    showToast('手机直传已开启：手机与电脑连同一 Wi-Fi，输入下方地址和令牌', 'success', 4500);
  } catch (e) {
    lan.error = e.message || String(e);
    showToast('开启手机直传失败：' + lan.error, 'error', 5000);
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
    showToast('已生成新的令牌', 'success');
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
  showToast('已复制：' + text, 'success', 2200);
}

const WHY = {
  'bad-token': '令牌不对，请对照电脑端显示的 6 位数字',
  'too-large': '文件超过 2 GiB 上限',
  'bad-file': '收到的不是 ZIP 文件',
  busy: '电脑端正在处理上一份数据，请稍后再试',
  'too-many-attempts': '失败次数过多，等待一分钟后重试',
};

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
      showProgress('解析手机上传的数据包…', 2);
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
        showToast(`已接收手机上传的数据包：${data.meta?.ridesTotal ?? '?'} 条骑行记录`, 'success', 4200);
      } else {
        showToast('已接收手机上传的数据包', 'success');
      }
    } else if (ev.type === 'parse-error') {
      lan.phase = 'error';
      lan.error = ev.error || '解析失败';
      hideProgress();
      showToast('解析手机上传的数据包失败：' + lan.error, 'error', 6000);
    } else if (ev.type === 'upload-rejected') {
      lan.phase = 'error';
      lan.error = WHY[ev.reason] || ev.reason || '上传被拒绝';
      showToast('手机上传失败：' + lan.error, 'error', 5000);
      hideProgress();
    } else if (ev.type === 'error') {
      lan.error = ev.message || '接收出错';
      showToast('接收出错：' + lan.error, 'error', 5000);
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

