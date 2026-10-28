// Electron 主进程：窗口、数据包解析（ZIP / 解压目录）、缓存、局域网直传、截图调试
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, nativeTheme, screen } from 'electron';
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

// 调试/冒烟测试：隔离用户数据目录。必须在任何 app.getPath('userData') 调用之前执行，
// 否则缓存/偏好会落到默认目录（下面的 cacheFile()/prefsFile() 都是惰性函数，此时尚未调用）。
const userDataArg = argValue('user-data');
if (userDataArg) {
  try {
    app.setPath('userData', path.resolve(userDataArg));
  } catch (e) {
    console.error('[args] 设置 userData 失败', e);
  }
}

/* ---------- 语言 / 主题偏好（主进程文案与窗口外观） ---------- */
const THEME_MODES = ['system', 'dark', 'light'];
const THEME_BG = { light: '#f4f6fa', dark: '#0b0f16' };
// Windows/Linux 原生窗口按钮区（titleBarOverlay）配色；height 与标题栏高度保持一致
const TITLEBAR_OVERLAY = {
  light: { color: '#fcfdff', symbolColor: '#3d4a5c', height: 58 },
  dark: { color: '#0a0e15', symbolColor: '#c3cfdd', height: 58 },
};

/**
 * 主进程文案：与渲染层共用 src/locales/<locale>.json（一个语言一个文件），
 * 主进程只读 `main` 段（系统弹窗 / 菜单 / 进度等），`ui` 段由渲染层使用。
 * 新增语言只需加一个 JSON 文件，两个进程的语言列表都会自动包含它。
 */
const LOCALES_DIR = path.join(__dirname, 'src', 'locales');

function readMainText() {
  const text = {};
  let codes = [];
  try {
    codes = fs
      .readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch (e) {
    console.error('[locale] 读取语言目录失败：', LOCALES_DIR, e);
    return { text, codes: ['zh', 'en'] };
  }
  for (const code of codes) {
    try {
      text[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8')).main || {};
    } catch (e) {
      console.error(`[locale] 读取 ${code}.json 失败：`, e);
    }
  }
  // 兜底语言排前面（中文 → 英文 → 其他按代码排序）
  const rank = (code) => (code === 'zh' ? -2 : code === 'en' ? -1 : 0);
  codes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { text, codes };
}

const { text: TEXT, codes: LOCALES } = readMainText();

// 用户偏好：主进程文案语言与实际主题模式（启动时由 readPrefs() 初始化）
let currentLocale = 'zh';
let themeMode = 'system';

/** 点分 key 取文案（如 'dialog.pickZip'） */
function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
}

/** 当前语言下取主进程文案；未知 key 回退中文，再回退 key 本身。 */
function tr(key, params) {
  let s = lookup(TEXT[currentLocale], key) ?? lookup(TEXT.zh, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** 指定语言取文案（用于对话框等必须立即定语言的场景）；非法 locale 由调用方回退。 */
function textFor(locale, key) {
  return lookup(TEXT[locale], key) ?? lookup(TEXT.zh, key) ?? key;
}

let win = null;
let settingsWin = null;

/** 当前所有存活窗口（主窗口 + 设置窗口） */
function allWindows() {
  return [win, settingsWin].filter((w) => w && !w.isDestroyed());
}

/** 向所有窗口广播 IPC（数据变更 / 偏好变更 / LAN 状态等，多窗口共享状态靠它同步） */
function broadcast(channel, payload) {
  for (const w of allWindows()) {
    try {
      w.webContents.send(channel, payload);
    } catch { /* 窗口已关闭 */ }
  }
}

/** 对话框/菜单事件的目标窗口：优先当前聚焦窗口，回退主窗口 */
function focusedOrMain() {
  const focused = BrowserWindow.getFocusedWindow();
  return focused && !focused.isDestroyed() ? focused : win;
}

/** 广播当前偏好给所有窗口（多窗口主题 / 语言 / 底图跟随状态同步） */
function broadcastPrefs() {
  broadcast('prefs:changed', { ...(readPrefs() || {}), theme: themeMode, locale: currentLocale });
}

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
  if (typeof input?.mapStyleAuto === 'boolean') data.mapStyleAuto = input.mapStyleAuto;
  if (input?.theme === 'system' || input?.theme === 'dark' || input?.theme === 'light') data.theme = input.theme;
  if (input?.locale === 'zh' || input?.locale === 'en') data.locale = input.locale;
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
  throw new Error(tr('error.badPackageType'));
}

async function parsePackage(target, sender = null) {
  const send = (message, percent) => {
    const payload = { message, percent };
    try {
      if (sender && !sender.isDestroyed?.()) sender.send('data:progress', payload);
      else broadcast('data:progress', payload);
    } catch { /* ignore */ }
  };
  send(tr('progress.reading'), 3);
  const reader = makeReader(target);
  send(tr('progress.parsing'), 8);
  const data = buildCyclingDataset(reader, {
    locale: currentLocale,
    onProgress: (message, percent) => send(message, percent),
  });
  if (!data.rides.length) throw new Error(tr('error.noRides'));
  send(tr('progress.writing'), 98);
  writeCache(data);
  send(tr('progress.done'), 100);
  return data;
}

/* ---------- 手机 → 电脑 局域网直传 ---------- */
// 协议见 docs/lan-upload-protocol.md：HTTP 上传 + UDP 广播发现，手机端把导出目录打包成 ZIP 直传。
let lan = null; // { receiver, dir }
let lanParseChain = Promise.resolve();
const lanUploadDir = () => path.join(app.getPath('userData'), 'uploads');

function sendLanState(payload) {
  broadcast('lan:state', payload);
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
    // 进度广播给所有窗口：设置窗口发起直传时也要能看到解析进度
    const data = await parsePackage(filePath, null);
    cleanupUploads(1);
    console.log(
      '[lan] 已解析手机上传的数据包',
      name,
      `${data.meta.ridesTotal} 条骑行`,
      `接收 ${receiveMs ?? '?'} ms / 解析 ${data.meta.parseMs} ms`
    );
    sendLanState({ type: 'parsed', name, bytes, receiveMs, data });
    broadcast('data:changed');
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
      locale: currentLocale,
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
/** 当前实际明暗：显式指定优先，system 模式跟随系统（nativeTheme 随 themeSource 同步） */
function resolvedDark() {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return nativeTheme.shouldUseDarkColors;
}

/**
 * 把主题应用到窗口原生外观：背景色 + 非 macOS 的 titleBarOverlay。
 * setTitleBarOverlay 只在 Windows/Linux 可用，用 feature check 兜底。
 */
function refreshWindowChrome(target = win, { overlay = true } = {}) {
  if (!target || target.isDestroyed?.()) return;
  const dark = resolvedDark();
  try {
    target.setBackgroundColor(dark ? THEME_BG.dark : THEME_BG.light);
  } catch (e) {
    console.error('[theme] 设置窗口背景色失败', e);
  }
  // 只有主窗口（Windows/Linux 自绘标题栏）需要 titleBarOverlay；设置窗口用系统标题栏
  if (overlay && !isMac && typeof target.setTitleBarOverlay === 'function') {
    try {
      target.setTitleBarOverlay(dark ? TITLEBAR_OVERLAY.dark : TITLEBAR_OVERLAY.light);
    } catch (e) {
      console.error('[theme] 设置标题栏配色失败', e);
    }
  }
}

/** 把当前主题应用到所有窗口的原生外观（背景色 + 非 macOS 的 titleBarOverlay） */
function refreshAllWindowChrome() {
  if (win && !win.isDestroyed()) refreshWindowChrome(win);
  if (settingsWin && !settingsWin.isDestroyed()) refreshWindowChrome(settingsWin, { overlay: false });
}

/** 切换主题模式：更新 nativeTheme.themeSource 并同步窗口原生外观 */
function applyThemeMode(mode) {
  if (!THEME_MODES.includes(mode)) return false;
  themeMode = mode;
  nativeTheme.themeSource = mode;
  refreshAllWindowChrome();
  return true;
}

/* ---------- 窗口几何记忆 ----------
 * 直接用 Electron 内置的 windowStatePersistence（需要给窗口一个唯一 name）：
 * 位置、大小、最大化/全屏状态由 Electron 存在 <userData>/Local State 的 windowStates 段，
 * 几何变化时自动更新，启动时自动还原并把超出屏幕的窗口夹回可见区域（保留尺寸）。
 * 因此这里不需要第三方库，也不需要自己在 resize/move/close 时落盘。
 * 注意：--window-size 调试参数优先于记忆值，该模式下不启用记忆（截图冒烟的尺寸不该写回）。
 */

function createWindow() {
  // 主题在窗口创建前就要定好，避免先出现深色底再被 paint 成浅色
  nativeTheme.themeSource = themeMode;
  const dark = resolvedDark();
  // 调试：--window-size=980x720 强制主窗口尺寸（用于冒烟截图设置页布局）
  const forcedSize = argValue('window-size');
  const winOptions = {
    // 首次启动的默认几何；有历史记录时由 windowStatePersistence 覆盖
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    // 内置窗口状态记忆（Electron 45+）：name 唯一标识这个窗口
    ...(forcedSize ? {} : { name: 'main', windowStatePersistence: true }),
    show: false,
    backgroundColor: dark ? THEME_BG.dark : THEME_BG.light,
    title: 'Samsung Health Viz',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 首帧注入：preload 同步读出并暴露为 window.api.initialPrefs，渲染层在 mount 前即可套用
      additionalArguments: [
        `--shv-theme=${themeMode}`,
        `--shv-locale=${currentLocale}`,
        `--shv-window=${argValue('window-kind') === 'settings' ? 'settings' : 'main'}`,
      ],
    },
  };
  if (isMac) {
    winOptions.titleBarStyle = 'hiddenInset';
    winOptions.trafficLightPosition = { x: 18, y: 18 };
  } else {
    // Windows/Linux：隐藏系统标题栏，用 titleBarOverlay 提供原生最小化/最大化/关闭按钮
    winOptions.titleBarStyle = 'hidden';
    winOptions.titleBarOverlay = dark ? TITLEBAR_OVERLAY.dark : TITLEBAR_OVERLAY.light;
  }

  if (forcedSize) {
    const [fw, fh] = forcedSize.split('x').map(Number);
    if (fw > 0 && fh > 0) {
      winOptions.width = fw;
      winOptions.height = fh;
    }
  }

  win = new BrowserWindow(winOptions);
  // 主题在启动期间被切换过的极端情况下，创建后按当前偏好再对齐一次
  refreshWindowChrome(win);
  // 主窗口关闭时一并关掉设置窗口，避免留下孤立窗口
  win.on('closed', () => {
    win = null;
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });

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

/* ---------- 设置窗口（独立窗口，不挤占主窗口） ---------- */
/**
 * 打开设置窗口：数据包管理 / 主题 / 语言 / 底图偏好都在这里。
 * 单例：已打开则聚焦；窗口用系统标题栏，内容只渲染设置页（不渲染主窗口标题栏/导航）。
 */
function createSettingsWindow(tab) {
  // 允许通过 ?tab=map|data|about 直达设置页某个分栏；未知值回落到默认「通用」
  const safeTab = typeof tab === 'string' && /^[a-z][a-z-]{0,19}$/.test(tab) ? tab : '';
  const targetHash = safeTab ? `/settings?tab=${encodeURIComponent(safeTab)}` : '/settings';
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    // 已打开时只在明确指定 tab 的情况切过去，避免点齿轮把用户当前所在分栏重置
    if (safeTab) {
      settingsWin.webContents
        .executeJavaScript(`location.hash = ${JSON.stringify('#' + targetHash)};`)
        .catch(() => {});
    }
    return settingsWin;
  }
  const dark = resolvedDark();
  // 默认尺寸别太高：按主窗口所在屏幕的可用区域自适应，保证小屏也能完整显示；
  // 有历史几何时由 windowStatePersistence 覆盖
  const hostDisplay = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const workArea = hostDisplay.workAreaSize;
  settingsWin = new BrowserWindow({
    width: Math.min(1000, Math.max(780, workArea.width - 160)),
    height: Math.min(720, Math.max(540, workArea.height - 140)),
    minWidth: 780,
    minHeight: 540,
    center: true,
    // 设置窗口同样记忆几何；它不能最大化/全屏，不需要恢复 displayMode
    name: 'settings',
    windowStatePersistence: { displayMode: false },
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: dark ? THEME_BG.dark : THEME_BG.light,
    title: textFor(currentLocale, 'window.settings'),
    // 不设 parent：设置是独立窗口，给 parent 会在 macOS 上变成子窗口，永远叠在主窗口上方
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [
        `--shv-theme=${themeMode}`,
        `--shv-locale=${currentLocale}`,
        '--shv-window=settings',
      ],
    },
  });
  refreshWindowChrome(settingsWin, { overlay: false });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) settingsWin.loadURL(`${devUrl}#${targetHash}`);
  else settingsWin.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'), { hash: targetHash });

  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    console.log('[settings] window opened', settingsWin?.getBounds());
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
}

/* ---------- IPC ---------- */
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    appVersion: app.getVersion(),
    releasePage: RELEASE_PAGE,
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    cachePath: cacheFile(),
    dev: !!process.env.VITE_DEV_SERVER_URL,
  }));

  // 设置页「检查更新」：复用与菜单相同的检查流程（开发模式弹说明，正式包走 electron-updater）
  ipcMain.handle('update:check', () => {
    checkUpdatesManually();
    return { ok: true };
  });

  // 读取上次缓存的数据包（首次启动返回 null）
  ipcMain.handle('data:load', () => {
    const data = readCache();
    return data ? { ok: true, data } : { ok: false };
  });

  // 地图偏好 / 界面主题 / 语言 持久化到 userData/settings.json
  ipcMain.handle('prefs:load', () => ({ ok: true, data: readPrefs(), path: prefsFile() }));
  ipcMain.handle('prefs:save', (_e, data) => {
    // 主进程文案 / 窗口外观跟随最新偏好，避免渲染层的 apply 调用失败时状态不一致
    if (THEME_MODES.includes(data?.theme) && data.theme !== themeMode) applyThemeMode(data.theme);
    if (LOCALES.includes(data?.locale) && data.locale !== currentLocale) setCurrentLocale(data.locale);
    const res = writePrefs(data);
    // 同步到其它窗口（设置窗口改主题/语言后主窗口立即生效，反之亦然）
    broadcastPrefs();
    return res;
  });

  /* ---------- 主进程原地取文案（优先用调用方传入的 locale，避免 prefs 落盘竞态） ---------- */
  const localeOf = (value) => (LOCALES.includes(value) ? value : currentLocale);

  // 选择 ZIP
  ipcMain.handle('data:pickZip', async (_e, localeArg) => {
    const locale = localeOf(localeArg);
    if (locale !== currentLocale) setCurrentLocale(locale);
    const res = await dialog.showOpenDialog(focusedOrMain(), {
      title: textFor(locale, 'dialog.pickZip'),
      properties: ['openFile'],
      filters: [{ name: textFor(locale, 'dialog.pickZipFilter'), extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  // 选择已解压文件夹
  ipcMain.handle('data:pickFolder', async (_e, localeArg) => {
    const locale = localeOf(localeArg);
    if (locale !== currentLocale) setCurrentLocale(locale);
    const res = await dialog.showOpenDialog(focusedOrMain(), {
      title: textFor(locale, 'dialog.pickFolder'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  // 打开设置窗口（标题栏齿轮按钮）
  ipcMain.handle('settings:open', (_e, tab) => {
    createSettingsWindow(tab);
    return { ok: true };
  });

  // 解析指定路径并缓存
  ipcMain.handle('data:parse', async (event, target) => {
    try {
      if (!target || !fs.existsSync(target)) {
        return { ok: false, error: tr('error.pathMissing', { path: target }) };
      }
      const data = await parsePackage(target, event.sender);
      // 解析结果已写入缓存：通知所有窗口刷新数据集（设置窗口导入的数据包要同步到主窗口）
      broadcast('data:changed');
      return { ok: true, data };
    } catch (e) {
      console.error('[parse] failed', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('data:clear', async () => {
    try {
      fs.rmSync(cacheFile(), { force: true });
      broadcast('data:changed');
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

  // ---- 主题 / 语言：渲染层切换后同步主进程（菜单、原生窗口外观、对话框文案） ----
  ipcMain.handle('theme:apply', (_e, mode) => {
    if (!THEME_MODES.includes(mode)) return { ok: false, error: tr('error.badTheme') };
    applyThemeMode(mode);
    broadcastPrefs();
    return { ok: true, mode: themeMode, theme: resolvedDark() ? 'dark' : 'light' };
  });

  ipcMain.handle('locale:apply', (_e, locale) => {
    if (!LOCALES.includes(locale)) return { ok: false, error: tr('error.badLocale') };
    setCurrentLocale(locale);
    broadcastPrefs();
    return { ok: true, locale: currentLocale };
  });

  // ---- 局域网直传（手机 App → 电脑） ----
  ipcMain.handle('lan:start', async () => {
    try {
      return await ensureLan();
    } catch (e) {
      console.error('[lan] 启动失败', e);
      return { ok: false, error: tr('lan.startFailed', { error: e.message || String(e) }) };
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
    if (!lan) return { ok: false, error: tr('lan.notStarted') };
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
      title: tr('update.newVersion.title'),
      message: tr('update.newVersion.message', { version: info.version }),
      detail: tr('update.newVersion.detail'),
      buttons: [tr('button.openRelease'), tr('button.later')],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) shell.openExternal(RELEASE_PAGE);
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: tr('update.ready.title'),
      message: tr('update.ready.message', { version: info.version }),
      detail: tr('update.ready.detail'),
      buttons: [tr('button.restartNow'), tr('button.later')],
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
      title: tr('update.latest.title'),
      message: tr('update.latest.message', { version: app.getVersion() }),
      buttons: [tr('button.ok')],
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[update] 失败：', err);
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    if (!wasManual) return;
    dialog.showMessageBox(win, {
      type: 'warning',
      title: tr('update.failed.title'),
      message: tr('update.failed.message'),
      detail: String(err?.message || err),
      buttons: [tr('button.openRelease'), tr('button.close')],
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
      title: tr('update.dev.title'),
      message: tr('update.dev.message'),
      detail: tr('update.dev.detail'),
      buttons: [tr('button.ok')],
    });
    return;
  }
  manualUpdateCheck = true;
  autoUpdater.checkForUpdates().catch((e) => console.error('[update] 检查失败：', e));
}

/* ---------- 菜单（保留常用项，避免默认 Electron 英文菜单） ---------- */
function buildMenu(locale = currentLocale) {
  // 所有应用功能都在应用内（独立设置窗口）里，原生菜单不再放功能项，保证 mac / Windows / Linux
  // 三个客户端行为一致：
  //  - macOS 保留系统级「应用菜单 + 编辑菜单」（复制/粘贴等快捷键依赖它）；
  //  - Windows / Linux 直接不显示菜单栏（窗口用自绘标题栏）。
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
}

/** 切换主进程文案语言并重建应用菜单；菜单文案由 buildMenu(locale) 统一提供 */
function setCurrentLocale(locale) {
  if (!LOCALES.includes(locale) || locale === currentLocale) return;
  currentLocale = locale;
  buildMenu(locale);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.setTitle(textFor(locale, 'window.settings'));
}

/** 启动时从 settings.json 读取语言与主题偏好（默认 zh + 跟随系统） */
function initPrefsState() {
  const prefs = readPrefs();
  if (LOCALES.includes(prefs?.locale)) currentLocale = prefs.locale;
  if (THEME_MODES.includes(prefs?.theme)) themeMode = prefs.theme;
  nativeTheme.themeSource = themeMode;
}

app.setName('Samsung Health Viz');
app.whenReady().then(() => {
  initPrefsState();
  registerIpc();
  buildMenu(currentLocale);
  createWindow();
  setupAutoUpdate();
  // 跟随系统时，系统深浅色变化要重新应用到窗口原生外观（背景色 / titleBarOverlay）
  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource !== 'system') return;
    refreshAllWindowChrome();
  });
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
