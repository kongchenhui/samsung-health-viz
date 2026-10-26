// 全局状态与动作（不引入 pinia，首期够用）
import { reactive } from 'vue';

export const store = reactive({
  ready: false,
  platform: '',
  info: null,
  dataset: null,
  mapStyle: 'amap-dark',
  mapDim: 18, // 底图淡化（0-100），让轨迹更突出
  yearFilter: 'all',
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
  // 支持 URL 参数调试/深链：?map=amap-dark&dim=40
  const params = new URLSearchParams(location.search);
  if (params.get('map')) store.mapStyle = params.get('map');
  if (params.get('dim') !== null && params.get('dim') !== '') store.mapDim = Number(params.get('dim'));

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
      showProgress('解析手机上传的数据包…', 2);
    } else if (ev.type === 'parsing') {
      lan.phase = 'parsing';
    } else if (ev.type === 'parsed') {
      lan.phase = 'done';
      lan.lastUpload = { name: ev.name, bytes: ev.bytes, at: Date.now() };
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

