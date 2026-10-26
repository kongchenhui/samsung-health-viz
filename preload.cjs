const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  loadCached: () => ipcRenderer.invoke('data:load'),
  startup: () => ipcRenderer.invoke('data:startup'),
  pickZip: () => ipcRenderer.invoke('data:pickZip'),
  pickFolder: () => ipcRenderer.invoke('data:pickFolder'),
  parse: (target) => ipcRenderer.invoke('data:parse', target),
  clear: () => ipcRenderer.invoke('data:clear'),
  reveal: (target) => ipcRenderer.invoke('data:reveal', target),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('data:progress', handler);
    return () => ipcRenderer.removeListener('data:progress', handler);
  },
  onMenuPickZip: (cb) => ipcRenderer.on('menu:pickZip', cb),
  onMenuPickFolder: (cb) => ipcRenderer.on('menu:pickFolder', cb),
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
