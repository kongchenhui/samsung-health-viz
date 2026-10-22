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
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
