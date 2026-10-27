// Electron 主进程：窗口、数据包解析（ZIP / 解压目录）、缓存、局域网直传、截图调试
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { folderReader, zipReader, buildCyclingDataset, resolvePackageDir, SCHEMA } from './src/core/parse.mjs';
import { startLanReceiver } from './src/core/lan-upload.mjs';

// electron-updater 是 CJS 包，主进程是 ESM，用 createRequire 引入最稳
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';

/* ---------- 命令行参数（调试/验证用） ---------- */
function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const shotPath = argValue('shot');
const shotDelay = Number(argValue('shot-delay') || 6000);
const shotPage = argValue('shot-page');
const shotJs = argValue('shot-js'); // 截图前执行一段渲染进程 JS（调试/验证用）

let win = null;

/* ---------- 缓存 ---------- */
const cacheFile = () => path.join(app.getPath('userData'), 'cycling-dataset.json');
const progressFile = () => path.join(app.getPath('userData'), 'parse-progress.json');

function readCache() {
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf8');
    const data = JSON.parse(raw);
    if (!data?.rides?.length) return null;
    // 数据集结构升级（如新增坐标基准字段）后，旧缓存不再兼容，要求重新选择数据包
    if (data?.meta?.schema !== SCHEMA) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  fs.writeFileSync(cacheFile(), JSON.stringify(data));
}

/* ---------- 本地偏好（地图主题 / 底图淡化 / Stadia Key） ---------- */
const prefsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readPrefs() {
  try {
    const data = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writePrefs(input) {
  // 只接受已知字段，避免渲染进程写入任意内容
  const data = {};
  if (typeof input?.mapStyle === 'string' && input.mapStyle.length <= 64) data.mapStyle = input.mapStyle;
  if (input?.mapDim !== null && input?.mapDim !== undefined && Number.isFinite(Number(input.mapDim))) {
    data.mapDim = Math.max(0, Math.min(100, Math.round(Number(input.mapDim))));
  }
  if (typeof input?.stadiaKey === 'string' && input.stadiaKey.length <= 256) {
    data.stadiaKey = input.stadiaKey.trim();
  }
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(data));
    return { ok: true, path: prefsFile() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/* ---------- 解析数据包 ---------- */
function makeReader(target) {
  const st = fs.statSync(target);
  if (st.isDirectory()) return folderReader(resolvePackageDir(target));
  if (/\.zip$/i.test(target)) return zipReader(target);
  throw new Error('请选择 .zip 数据包或解压后的文件夹');
}

async function parsePackage(target, sender) {
  const send = (message, percent) => {
    try {
      sender?.send('data:progress', { message, percent });
    } catch { /* ignore */ }
  };
  send('读取数据包…', 3);
  const reader = makeReader(target);
  send('解析运动记录…', 8);
  const data = buildCyclingDataset(reader, {
    onProgress: (message, percent) => send(message, percent),
  });
  if (!data.rides.length) throw new Error('数据包里没有找到骑行记录（exercise_type = 11007）');
  send('写入缓存…', 98);
  writeCache(data);
  send('完成', 100);
  return data;
}

/* ---------- 手机 → 电脑 局域网直传 ---------- */
// 协议见 docs/lan-upload-protocol.md：HTTP 上传 + UDP 广播发现，手机端把导出目录打包成 ZIP 直传。
let lan = null; // { receiver, dir }
let lanParseChain = Promise.resolve();
const lanUploadDir = () => path.join(app.getPath('userData'), 'uploads');

function sendLanState(payload) {
  try {
    win?.webContents.send('lan:state', payload);
  } catch { /* 窗口已关闭 */ }
}

/** 只保留最近 N 份上传的 ZIP，避免 userData 无限增长 */
function cleanupUploads(keep = 1) {
  const dir = lanUploadDir();
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  } catch { /* 目录不存在等，忽略 */ }
}

async function handleLanUpload(event) {
  const { name, path: filePath, bytes, receiveMs } = event;
  sendLanState({ type: 'parsing', name, bytes, receiveMs });
  try {
    const data = await parsePackage(filePath, win?.webContents);
    cleanupUploads(1);
    console.log(
      '[lan] 已解析手机上传的数据包',
      name,
      `${data.meta.ridesTotal} 条骑行`,
      `接收 ${receiveMs ?? '?'} ms / 解析 ${data.meta.parseMs} ms`
    );
    sendLanState({ type: 'parsed', name, bytes, receiveMs, data });
  } catch (e) {
    console.error('[lan] 解析手机上传的数据包失败', e);
    sendLanState({ type: 'parse-error', name, error: e.message || String(e) });
  }
}

let lanStarting = null;
async function ensureLan() {
  if (lan?.receiver?.info().running) return { ok: true, ...lan.receiver.info() };
  // 连点「开启接收」时复用同一个启动流程，避免起两个接收器抢端口
  if (lanStarting) return lanStarting;
  lanStarting = (async () => {
    const dir = lanUploadDir();
    const receiver = await startLanReceiver({
      uploadDir: dir,
      onEvent: (ev) => {
        if (ev.type === 'upload-saved') {
          // 同一时间只解析一个包，串行排队，避免并发写缓存
          lanParseChain = lanParseChain.then(() => handleLanUpload(ev)).catch(() => {});
          return;
        }
        sendLanState(ev);
      },
    });
    lan = { receiver, dir };
    cleanupUploads(1);
    return { ok: true, ...receiver.info() };
  })().finally(() => {
    lanStarting = null;
  });
  return lanStarting;
}

/* ---------- 窗口 ---------- */
function createWindow() {
  const winOptions = {
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0f16',
    title: 'Samsung Health Viz',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (isMac) {
    winOptions.titleBarStyle = 'hiddenInset';
    winOptions.trafficLightPosition = { x: 18, y: 18 };
  } else {
    // Windows/Linux：隐藏系统标题栏，用 titleBarOverlay 提供原生最小化/最大化/关闭按钮
    winOptions.titleBarStyle = 'hidden';
    winOptions.titleBarOverlay = {
      color: '#0a0e15',
      symbolColor: '#c3cfdd',
      height: 58,
    };
  }

  win = new BrowserWindow(winOptions);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'));
  }

  win.once('ready-to-show', () => win.show());

  if (shotPath) {
    win.webContents.on('console-message', (...args) => {
      const detail = args[1];
      if (typeof detail === 'object' && detail) {
        console.log(`[renderer:${detail.level}] ${detail.message}`);
      } else if (typeof args[2] === 'string') {
        console.log(`[renderer] ${args[2]}`);
      }
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[load-failed]', code, desc);
    });
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (shotPage) {
            await win.webContents.executeJavaScript(
              `location.hash = ${JSON.stringify(shotPage)}; window.dispatchEvent(new HashChangeEvent('hashchange'));`
            );
            await new Promise((r) => setTimeout(r, 2500));
          }
          if (shotJs) {
            try {
              const r = await win.webContents.executeJavaScript(shotJs);
              console.log('[shot-js]', JSON.stringify(r));
            } catch (e) {
              console.error('[shot-js] failed', e);
            }
            await new Promise((r) => setTimeout(r, 900));
          }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[shot] saved', shotPath, img.getSize());
        } catch (e) {
          console.error('[shot] failed', e);
        }
        app.quit();
      }, shotDelay);
    });
  }
}

/* ---------- IPC ---------- */
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    cachePath: cacheFile(),
    dev: !!process.env.VITE_DEV_SERVER_URL,
  }));

  // 读取上次缓存的数据包（首次启动返回 null）
  ipcMain.handle('data:load', () => {
    const data = readCache();
    return data ? { ok: true, data } : { ok: false };
  });

  // 地图偏好（底图主题 / 淡化 / Stadia Key）持久化到 userData/settings.json
  ipcMain.handle('prefs:load', () => ({ ok: true, data: readPrefs(), path: prefsFile() }));
  ipcMain.handle('prefs:save', (_e, data) => writePrefs(data));

  // 选择 ZIP
  ipcMain.handle('data:pickZip', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择三星健康导出的 ZIP 数据包',
      properties: ['openFile'],
      filters: [{ name: 'Samsung Health 数据包', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  // 选择已解压文件夹
  ipcMain.handle('data:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择解压后的数据包文件夹',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  // 解析指定路径并缓存
  ipcMain.handle('data:parse', async (event, target) => {
    try {
      if (!target || !fs.existsSync(target)) {
        return { ok: false, error: '路径不存在：' + target };
      }
      const data = await parsePackage(target, event.sender);
      return { ok: true, data };
    } catch (e) {
      console.error('[parse] failed', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('data:clear', async () => {
    try {
      fs.rmSync(cacheFile(), { force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('data:reveal', (_e, target) => {
    if (target && fs.existsSync(target)) {
      const st = fs.statSync(target);
      if (st.isDirectory()) shell.openPath(target);
      else shell.showItemInFolder(target);
    }
  });

  // 首次启动后解析（命令行 --data= 指定）
  ipcMain.handle('data:startup', async (event) => {
    const target = argValue('data');
    if (!target) return { ok: false };
    try {
      const data = await parsePackage(target, event.sender);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  // ---- 局域网直传（手机 App → 电脑） ----
  ipcMain.handle('lan:start', async () => {
    try {
      return await ensureLan();
    } catch (e) {
      console.error('[lan] 启动失败', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('lan:stop', async () => {
    try {
      const prev = lan;
      lan = null;
      await prev?.receiver.stop();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('lan:status', () => {
    if (!lan) return { ok: true, running: false, uploadDir: lanUploadDir() };
    return { ok: true, ...lan.receiver.info() };
  });

  ipcMain.handle('lan:token', () => {
    if (!lan) return { ok: false, error: '接收器未启动' };
    return { ok: true, token: lan.receiver.regenerateToken() };
  });

  ipcMain.handle('lan:reveal', () => {
    const dir = lanUploadDir();
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle('lan:clear', () => {
    cleanupUploads(0);
    sendLanState({ type: 'cleared' });
    return { ok: true };
  });

  // 渲染进程不能直接用 Electron API，复制到剪贴板走主进程
  ipcMain.handle('app:copy', (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('app:openExternal', (_e, url) => {
    const target = String(url || '');
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
  });
}

/* ---------- 自动更新（electron-updater + GitHub Release） ---------- */
const RELEASE_PAGE = 'https://github.com/kongchenhui/samsung-health-viz/releases/latest';
// macOS 未签名时 Squirrel.Mac 无法校验并安装更新，只能提示去发布页手动下载；
// Windows（NSIS）与 Linux（AppImage）可自动下载，并按 blockmap 做增量更新。
const canAutoInstall = process.platform !== 'darwin';
let manualUpdateCheck = false;

function setupAutoUpdate() {
  if (!app.isPackaged) return; // 开发模式不检查更新
  autoUpdater.autoDownload = canAutoInstall;
  autoUpdater.autoInstallOnAppQuit = canAutoInstall;

  autoUpdater.on('update-available', (info) => {
    if (canAutoInstall) return; // 自动下载完成后在 update-downloaded 里提示
    dialog.showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: `Samsung Health Viz ${info.version} 已发布`,
      detail: 'macOS 版暂不支持自动安装（应用未签名），请打开发布页手动下载安装包。',
      buttons: ['打开发布页', '稍后'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) shell.openExternal(RELEASE_PAGE);
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: '更新已就绪',
      message: `Samsung Health Viz ${info.version} 已下载`,
      detail: '重启应用后自动安装新版本。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox(win, {
      type: 'info',
      title: '已是最新版本',
      message: `当前版本 ${app.getVersion()} 已是最新`,
      buttons: ['好'],
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[update] 失败：', err);
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    if (!wasManual) return;
    dialog.showMessageBox(win, {
      type: 'warning',
      title: '检查更新失败',
      message: '暂时无法检查更新',
      detail: String(err?.message || err),
      buttons: ['打开发布页', '关闭'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) shell.openExternal(RELEASE_PAGE);
    });
  });

  const check = (manual) => {
    manualUpdateCheck = manual;
    autoUpdater.checkForUpdates().catch((e) => console.error('[update] 检查失败：', e));
  };
  // 启动 8 秒后检查一次，之后每 6 小时检查一次
  setTimeout(() => check(false), 8000);
  setInterval(() => check(false), 6 * 60 * 60 * 1000);
}

async function checkUpdatesManually() {
  if (!app.isPackaged) {
    await dialog.showMessageBox(win, {
      type: 'info',
      title: '开发模式',
      message: '开发模式下不检查更新',
      detail: '用构建后的安装包运行时才会检查 GitHub Release。',
      buttons: ['好'],
    });
    return;
  }
  manualUpdateCheck = true;
  autoUpdater.checkForUpdates().catch((e) => console.error('[update] 检查失败：', e));
}

/* ---------- 菜单（保留常用项，避免默认 Electron 英文菜单） ---------- */
function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '数据',
      submenu: [
        {
          label: '选择数据包（ZIP）…',
          click: () => win?.webContents.send('menu:pickZip'),
        },
        {
          label: '选择解压文件夹…',
          click: () => win?.webContents.send('menu:pickFolder'),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: `检查更新…（当前 ${app.getVersion()}）`, click: () => checkUpdatesManually() },
        { label: '打开发布页', click: () => shell.openExternal(RELEASE_PAGE) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('Samsung Health Viz');
app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  setupAutoUpdate();
  // 调试/联调：--lan-auto 启动时直接开启接收器（不开界面也能收手机上传）
  if (argValue('lan-auto')) {
    ensureLan()
      .then((info) => console.log('[lan-auto] listening', JSON.stringify({ port: info.port, token: info.token, urls: info.urls })))
      .catch((e) => console.error('[lan-auto] failed', e));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// 退出时关掉接收器（UDP 广播与 HTTP 端口都要释放）
app.on('before-quit', () => {
  const prev = lan;
  lan = null;
  prev?.receiver.stop().catch(() => {});
});
