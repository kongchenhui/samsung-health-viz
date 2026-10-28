# AGENTS.md — Samsung Health Viz

给在本仓库工作的 AI 编码代理的项目约定。用户级全局约定（git 授权、隐私、网络代理）同样适用；这里是本项目特有的部分。

## 项目概览

Electron 45 + Vue 3 + Vite 8 的本地桌面应用：导入三星健康（Samsung Health）导出的数据包，解析骑行记录与 GPS 轨迹，生成生涯统计、骑行列表与地图可视化。手机直传 App 在 `android/`（Java + Gradle）。

- 纯 JavaScript（ESM），Vue SFC + `<script setup>`；**没有 TypeScript、ESLint、Prettier**
- Node ≥ 20（CI 用 22）、pnpm
- 主进程 ESM（`main.mjs`），preload 是 CJS（`preload.cjs`），解析层纯 Node（`src/core/`）

## 常用命令

```bash
pnpm install
pnpm dev            # Vite(5183) + Electron，渲染层热更新；改了 main.mjs / preload.cjs / src/core 要重启
pnpm build          # 只构建渲染层到 dist/renderer
pnpm start          # 用 dist 产物启动
pnpm check          # 坐标判定 + 局域网直传自检
pnpm check:coord    # 只跑坐标判定
pnpm check:lan      # 只跑局域网直传（含伪造导出包→上传→解析全链路）
pnpm dist:mac / dist:win / dist:linux   # electron-builder；本地打包前先确认，平时由 CI 出包
```

## 目录

```
main.mjs / preload.cjs        Electron 主进程 / contextBridge
src/core/                     主进程侧：parse（数据包解析）、lan-upload、coord-sys
src/locales/<locale>.json     多语言（meta/ui/main 三段，主进程与渲染层共用）
src/renderer/
  lib/                        纯逻辑：i18n、cities、format、data、leaflet、palette、theme-map
  data/cities/<国家>.json     城市坐标，一个国家一个文件
  components/  views/         Vue 组件与页面（设置页是独立窗口）
docs/development.md           维护者文档（结构、解析规则、打包发布、调试参数）
docs/release-notes/           每个版本的 Release 说明
scripts/                      开发启动与自检脚本
```

## 开发约定

- **设置窗口是独立窗口**：所有进入设置页的入口只做 `router.push('/settings')`（可带 `?tab=general|map|data|about`），唯一的开窗点是 `src/renderer/router.js` 的 `router.beforeEach`；组件里不要再直接调用 `window.api.openSettings()`。
- **设置窗口不要加 `parent` / `alwaysOnTop`**：macOS 会把有 parent 的窗口当子窗口，永远叠在主窗口上方。
- **i18n 文案只放 JSON**：`src/locales/<locale>.json` 的 `ui`（渲染层）/ `main`（主进程）两段；zh/en key 必须同步；日期、星期、时长等模板放 `ui.format`，不要在 JS 里按语言写死分支；新增语言 = 新增一个 JSON 文件。
- **用户数据不国际化**：导出包里的原始内容（天气短语、设备/供应商名、单位等）一律原样展示，不翻译成界面语言；`src/locales` 只放界面文案与格式模板，不要为数据内容新建语言映射表。
- **主题颜色**：结构色（坐标轴、描边、tooltip、底图 casing）跟随深浅主题；数据色（年份、车速色阶、站点色）两套主题共用同一组亮色，不要“整体变暗”。
- **城市坐标只用于就近匹配**（80km 内取最近地级行政区，超出显示「区域 N」），不参与地图渲染；不要把县级市加进来。
- **地图坐标**：轨迹基准（`wgs84` / `gcj02`）由 `src/core/coord-sys.mjs` 判定，渲染前统一走 `src/renderer/lib/leaflet.js` 的 `projectPoint`；改判定或换算逻辑先跑 `pnpm check:coord`。
- **主进程文本**：不要往 `main.mjs` 里内嵌文案，读 `src/locales/*.json` 的 `main` 段；新增 IPC 时同步改 `preload.cjs`。
- **多窗口状态**：偏好变更用 `broadcastPrefs()`，数据变更用 `broadcast()`，不要只在单个窗口里改 store。
- **滚动条**：主窗口和设置窗口的滚动区域都要接入主题滚动条（`.view` / `.split-list` / `.settings-content` / `.settings-sidebar`），亮色/暗色各一套。
- **窗口几何**：用 Electron 内置的 `windowStatePersistence`（窗口 `name` 唯一，状态在 `<userData>/Local State` 的 `windowStates`），不要再引 `electron-window-state` 之类的库或手写落盘逻辑。
- **滚动位置按页面记忆**：主窗口 `.view` 是所有路由共用的滚动容器，`App.vue` 按 `route.fullPath` 记忆/还原 `scrollTop`；设置页 `.settings-content` 按 `?tab=` 记忆。新增页面/分栏沿用这套机制，不要在别的组件里直接改容器滚动位置。
- 代码注释用中文，写清“为什么”而不是复述代码；新增/修改数据格式时同步更新 `docs/development.md` 与对应自检。

## 数据与隐私

- 真实三星健康导出包、解析缓存、账号/手机号、本机路径、设备 UUID、API Key **一律不入库**。
- 测试数据、截图、Release 说明里的示例必须虚构，并做脱敏（手机号、局域网 IP、令牌、绝对路径）。
- Stadia API Key 只放本机 `<userData>/settings.json` 或本地 `.env.local`（已 gitignore），不要写进仓库或安装包。
- 临时评审/调试产物（如 `.review/`）不入库。

## Git 与发布

- 暂存、提交、推送、打 tag、改写历史都**必须由用户单独明确指示**；不要主动执行，也不要沿用上一次授权。
- 提交作者使用 GitHub noreply 邮箱；commit message 和 Release 说明不得包含真实个人数据。
- 发布流程：
  1. 改 `package.json` 的 `version`，同时改 `android/app/build.gradle` 的 `versionCode` / `versionName`；
  2. 新增 `docs/release-notes/vX.Y.Z.md`；
  3. commit（`release: vX.Y.Z — 摘要`），打 tag `vX.Y.Z` 并推送 `main` 与 tag；
  4. CI 会校验 tag 与 `package.json` 版本一致，构建三平台安装包 + Android APK 并自动创建 GitHub Release。
- 不要在网页手动创建 Release，会和 CI 冲突。

## 调试

主进程支持的调试参数（仅本机冒烟用，别写进正式流程）：

| 参数 | 作用 |
|---|---|
| `--user-data=<dir>` | 隔离用户数据目录（缓存 / settings.json / 窗口几何 Local State），截图和测试必须用 |
| `--window-size=1440x940` | 强制主窗口尺寸（该次运行不启用窗口几何记忆） |
| `--window-kind=settings` | 主窗口直接渲染设置页（截图用；正式入口仍走独立窗口） |
| `--data=<path>` | 启动后解析指定数据包 |
| `--shot=<png>` / `--shot-delay=<ms>` / `--shot-page=<hash>` / `--shot-js=<js>` | 延时截图、跳路由、截图前执行 JS |
| `--lan-auto` | 启动即开启局域网接收器（不开界面收手机上传） |

- 改 `main.mjs` / `preload.cjs` / `src/core/**` 必须重启 `pnpm dev`；只改渲染层用热更新。
- 截图/测试使用临时 userData，避免污染真实缓存与偏好；截图前检查账号、IP、路径是否脱敏。
- 地图瓦片需要联网；国内直连 Stadia 可能不稳定，需要代理时确认系统代理已开启。

## 不要做

- 不要把系统语言/主题推断成用户偏好——语言、主题、底图都是显式配置。
- 不要在渲染层引用主进程模块（`src/core/**`、`main.mjs`）或 Node API。
- 不要提交 `dist/`、`release/`、`.cache/`、`node_modules/` 等构建产物/缓存。
- 不要在没有用户明确要求时打包或发布。
