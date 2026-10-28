const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* ---------- 首帧偏好注入 ----------
 * 主进程 createWindow() 用 webPreferences.additionalArguments 传入
 * --shv-theme=<system|dark|light> / --shv-locale=<zh|en>，
 * 这里同步解析并在渲染层 mount 之前暴露为 window.api.initialPrefs，
 * 避免「先按默认值渲染一帧、再等异步 prefs:load 切换」的闪烁。
 */
const THEME_MODES = ['system', 'dark', 'light'];
const LOCALES = ['zh', 'en'];

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const initialTheme = argValue('shv-theme');
const initialLocale = argValue('shv-locale');
// 窗口类型：main（主窗口，带自定义标题栏/导航） / settings（独立设置窗口）
const windowKind = argValue('shv-window') === 'settings' ? 'settings' : 'main';

contextBridge.exposeInMainWorld('api', {
  // 同步可用的首帧偏好：{ theme: 'system'|'dark'|'light', locale: 'zh'|'en' }
  initialPrefs: Object.freeze({
    theme: THEME_MODES.includes(initialTheme) ? initialTheme : 'system',
    locale: LOCALES.includes(initialLocale) ? initialLocale : 'zh',
  }),
  // 当前窗口类型（'main' | 'settings'），渲染层据此决定是否渲染主窗口外壳
  windowKind,
  // 打开独立的设置窗口（单例，已打开则聚焦）
  openSettings: (tab) => ipcRenderer.invoke('settings:open', tab),
  info: () => ipcRenderer.invoke('app:info'),
  loadCached: () => ipcRenderer.invoke('data:load'),
  startup: () => ipcRenderer.invoke('data:startup'),
  // locale 作为 invoke 参数传入，避免「刚切语言就打开对话框」时主进程读到旧偏好（竞态）
  pickZip: (locale) => ipcRenderer.invoke('data:pickZip', locale),
  pickFolder: (locale) => ipcRenderer.invoke('data:pickFolder', locale),
  parse: (target) => ipcRenderer.invoke('data:parse', target),
  clear: () => ipcRenderer.invoke('data:clear'),
  reveal: (target) => ipcRenderer.invoke('data:reveal', target),
  loadPrefs: () => ipcRenderer.invoke('prefs:load'),
  savePrefs: (data) => ipcRenderer.invoke('prefs:save', data),
  // 主题 / 语言：切换后同步主进程（nativeTheme、原生标题栏、应用菜单、对话框文案）
  applyTheme: (mode) => ipcRenderer.invoke('theme:apply', mode),
  // 设置页「检查更新」：走主进程的 electron-updater 流程
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  // 多窗口同步：另一窗口改了偏好 / 数据包后主进程会广播
  onPrefsChanged: (cb) => {
    const handler = (_e, prefs) => cb(prefs);
    ipcRenderer.on('prefs:changed', handler);
    return () => ipcRenderer.removeListener('prefs:changed', handler);
  },
  onDataChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('data:changed', handler);
    return () => ipcRenderer.removeListener('data:changed', handler);
  },
  applyLocale: (locale) => ipcRenderer.invoke('locale:apply', locale),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('data:progress', handler);
    return () => ipcRenderer.removeListener('data:progress', handler);
  },
  // 局域网直传（手机 App → 电脑）
  lanStart: () => ipcRenderer.invoke('lan:start'),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanStatus: () => ipcRenderer.invoke('lan:status'),
  lanToken: () => ipcRenderer.invoke('lan:token'),
  lanReveal: () => ipcRenderer.invoke('lan:reveal'),
  lanClear: () => ipcRenderer.invoke('lan:clear'),
  onLanState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('lan:state', handler);
    return () => ipcRenderer.removeListener('lan:state', handler);
  },
  copyText: (text) => ipcRenderer.invoke('app:copy', text),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
