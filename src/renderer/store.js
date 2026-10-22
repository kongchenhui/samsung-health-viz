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
