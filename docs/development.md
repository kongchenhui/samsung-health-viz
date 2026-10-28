# 开发说明

面向维护者的文档：技术栈、目录结构、数据与文案约定、打包发布、调试方式。用户安装与使用看 [README](../README.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 45（主进程 ESM） |
| 渲染 | Vue 3（SFC + `<script setup>`）+ vue-router（hash 模式） |
| 构建 | Vite 8 + `@vitejs/plugin-vue` |
| 图表 | ECharts 6 + vue-echarts（折线、柱状、日历热力） |
| 地图 | Leaflet 1.9（高德暗色/标准/卫星、Stadia 全系 9 款、Esri 卫星、OSM、离线无底图；轨迹描边 + 底图淡化 + 全屏） |
| 数据 | `adm-zip` 直接读取用户选择的 ZIP；CSV 自行解析（三星导出格式：两行文件头 + 行尾空字段） |
| 手机直传 | Android App（纯 Java、无第三方依赖）：选目录 → 打包 ZIP → 局域网 HTTP 上传；桌面端内置接收器（HTTP + UDP 广播发现，`src/core/lan-upload.mjs`） |

## 目录结构

```
samsung-health-viz/
├── main.mjs                 # Electron 主进程：窗口、数据包选择/解析/缓存、局域网直传、自动更新、截图调试
├── preload.cjs              # contextBridge 暴露 window.api
├── src/core/                # 主进程侧模块（Node 环境）
│   ├── parse.mjs            #   数据包解析（CSV/JSON/ZIP/目录），输出骑行数据集
│   ├── lan-upload.mjs       #   局域网直传接收器（协议见 [lan-upload-protocol.md](lan-upload-protocol.md)）
│   └── coord-sys.mjs        #   坐标基准判定（wgs84 / gcj02，含实测依据与判定顺序）
├── src/locales/             # 多语言文案：一个语言一个 JSON（主进程与渲染层共用）
│   ├── zh.json              #   { meta: 语言自称/htmlLang, ui: 界面文案, main: 主进程文案 }
│   └── en.json
├── src/renderer/            # 渲染层（Vue 3）
│   ├── main.js  App.vue  router.js  store.js  styles.css
│   ├── lib/                 # 纯逻辑：format / data 派生统计 / leaflet 底图 / palette / theme-map / i18n / cities
│   ├── data/cities/         # 城市坐标：一个国家一个 JSON（cn.json 覆盖国内地级行政区与港澳台）
│   ├── components/          # TitleBar、MapPanel、LineChart、BarChart、MonthHeatmap…
│   └── views/               # Welcome / Career / Rides / RideDetail / Settings（独立设置窗口）
├── scripts/                 # 开发与自检脚本
│   ├── dev.mjs              #   开发启动器（Vite + Electron）
│   ├── check-coord-sys.mjs  #   坐标判定自检（改判定逻辑后先跑它）
│   └── check-lan-upload.mjs #   局域网直传自检（伪造导出包 → 上传 → 解析全链路）
├── android/                 # 手机直传 App（Java + Gradle，纯系统 API）
├── docs/screenshots/        # 界面截图（虚构演示数据，已脱敏）
├── build/                   # 应用图标与 macOS entitlements
└── dist/                    # 构建产物（pnpm build 生成）
```

## 多语言文案（src/locales/）

- 一个语言一个文件，文件名就是语言代码（`zh.json` / `en.json`），新增语言只需复制一份改内容；
  设置页的语言列表、主进程语言校验都由文件列表自动生成，不用改代码。
- 每个文件分三段：`meta`（语言自称 `name`、`htmlLang`）、`ui`（渲染层文案）、`main`（主进程菜单 / 系统弹窗 / 进度文案）。
- 渲染层用 `t('点分.key')` 取文案，回退链：当前语言 → 中文 → 英文 → 调用方 fallback → key 本身；
  日期 / 时长 / 星期等格式串也在 `ui.format` 里，格式化函数不再按语言写死分支。
- 主进程通过 `main.mjs` 的 `readMainText()` 读取同目录文件；`src/locales/**/*` 已加入 electron-builder 的 `files`。

## 城市坐标（src/renderer/data/cities/）

- 一个国家一个 JSON：`cn.json`、`jp.json`、`us.json`…，文件名是国家代码；`cn.json` 覆盖国内
  地级行政区（地级市 / 自治州 / 地区 / 盟）与港澳台主要城市，共 348 个点位，用于把轨迹聚集区就近匹配成地名；县级市不参与匹配。
- 结构：`{ country, coordSys, cities: [{ names: { zh, en }, lat, lon }] }`；城市名按语言存，
  缺哪个语言就回退中文。`coordSys` 标明坐标基准（`cn.json` 为高德 GCJ-02，国外城市为 WGS-84）。
- 匹配逻辑在 `src/renderer/lib/cities.js`：起点 80km 内取最近城市，超出则显示「区域 N」；
  坐标只用于匹配，不参与地图渲染。

## 数据来源与解析规则

只读解析以下文件（不修改原始数据包）：

- `com.samsung.shealth.exercise.*.csv`：筛选骑行（11007），读取时长、距离、热量、爬升、平均/最大心率、最高速度等；
- `jsons/com.samsung.shealth.exercise/*/UUID.location_data.json`：逐秒 GPS（经纬度、海拔、时间）→ 抽稀 + Douglas-Peucker 简化后作为轨迹；
- `jsons/.../UUID.live_data.json`：运动采样，用于速度曲线与每公里分段（缺失时用距离增量估算）；
- `com.samsung.shealth.tracker.heart_rate.*.csv` + `binning_data.json`：live_data 没有心率时，用分钟级心率桶补齐；
- `exercise.weather` / `exercise.recovery_heart_rate`：按 `exercise_id` 关联天气与恢复心率。

其他要点：CSV 首行是元信息、第二行才是表头；数据行末尾多一个空字段；所有时刻均为 UTC（+8 为北京时间）；
`day_time` 是本地日期锚点。

## 坐标基准

三星健康导出里**没有**显式的“坐标基准”字段，但轨迹 JSON 会暴露来源格式：

- **手机 App 写入的轨迹点带 `version` 字段**（对应的 `location_data_internal` 还有 `source_type`）→ 系统定位服务/地图 SDK 给出，**GCJ-02**；
- **手表记录的轨迹点没有** → GNSS 原始定位，**WGS-84**（这也是手机上的三星健康能显示正常的原因：它在渲染时按来源换算）。

解析时按「点格式（version）→ 设备类型（device_profile 里 10061=穿戴）回退」判定每条骑行的 `coordSys`，
渲染时再按「轨迹基准 ↔ 底图基准」换算：高德（GCJ-02）与 WGS-84 轨迹 → 纠偏、与 GCJ-02 轨迹 → 直通；
OSM/卫星（WGS-84）与 GCJ-02 轨迹 → 反算回 WGS-84。详见 `src/renderer/lib/leaflet.js` 的 `projectPoint`。

全部 31 条轨迹抽样 1966 个点做水面命中校验：高德底图 17 点、OSM 12 点（均为桥/堤等真实过水点），
说明两条链路都已对齐。调试可用 `?proj=raw|gcj` 强制指定。

> 之前还有一个「深灰/浅灰画布（Esri Canvas）」主题：其中国区矢量数据与 WGS-84 网格本身存在约 500m 错位且非常稀疏，
> 会让轨迹“看起来偏移”，已从主题列表中移除；需要暗色底图请用「高德 · 暗色」。

## 地图底图

生涯页 / 详情页右上角可切换底图，并在「底图淡化」滑杆调节底图强度（轨迹带深色描边，任何底图下都能看清）：

- **高德 · 暗色（默认）**：压暗后的高德矢量图 + 中文地名，彩色轨迹最醒目；
- **Stadia Maps 全家桶**（均需 API Key）：
  - `Alidade Smooth / Alidade Smooth Dark`：素雅、标签与 POI 少，最适合叠大量彩色轨迹；
  - `Alidade Bright`：全彩 Alidade，水体/林地/农田/公园分色，风格明快；
  - `Alidade Satellite`：卫星影像 + 标注（**需要 Stadia Standard 及以上套餐**，免费 Key 会 403）；
  - `Outdoors`：户外风格，步道/等高线更完整；
  - `Stamen Toner / Stamen Terrain / Stamen Watercolor`：Stamen 经典风格（Watercolor 官方放大上限 16 级）；
  - `OSM Bright`：经典 OSM Bright 样式；
- 高德 · 标准 / 高德 · 卫星 / Esri 卫星；
- OpenStreetMap（WGS-84 参考底图，可用来核对轨迹是否贴合道路）；
- 无底图（离线，纯轨迹 + 深色网格）。

地图右上角「全屏」把地图卡片铺满内容区（保留顶部标题栏与导航），底图/淡化/年份与区域筛选照常可用，
按 `Esc` 或再点一次按钮退出；进出全屏与容器尺寸变化都会重新测量并回到轨迹视野。

底图主题、「底图淡化」和 Stadia API Key 保存在 `<userData>/settings.json`
（macOS 为 `~/Library/Application Support/Samsung Health Viz/settings.json`）；
`?map=` / `?dim=` 调试参数只对本次启动生效，不会覆盖已保存的偏好。

### Stadia API Key

Stadia 的 9 款底图都需要 API Key（桌面端 `file://` 不走 localhost 免鉴权）。两种配置方式：

1. **应用内填写（推荐）**：设置 → 地图 →「填写 Key」；或第一次选到 Stadia 底图时按弹窗提示粘贴。
   Key 只保存在本机 `settings.json`，不会写进仓库或安装包。
2. **构建时注入**：项目根目录建 `.env.local`（已 gitignore），写入 `VITE_STADIA_API_KEY=<你的 Key>` 后重新 `pnpm build`。
   对外分发不要把个人 Key 打进安装包。

免费账号即可覆盖除 Alidade Satellite 外的样式（有额度限制）：<https://client.stadiamaps.com/dashboard/>。
国内直连 `tiles.stadiamaps.com` 可能不稳定，需要代理时确认系统代理已开启（Electron 跟随系统代理）。
版权：Stadia Maps / OpenMapTiles / OpenStreetMap，Stamen 系列另需署名 Stamen Design，
Alidade Satellite 另含 CNES / Airbus DS / PlanetObserver 影像版权（地图右下角已按各样式要求展示）。

## 打包与发布

全部由 `electron-builder` 的 target 完成（配置见 `package.json > build`）：

```bash
pnpm dist:mac     # macOS：dmg + pkg + zip（在 macOS 上运行）
pnpm dist:win     # Windows：nsis 安装包 + 便携 zip（可在 macOS 交叉构建）
pnpm dist:linux   # Linux：AppImage + deb（在 Linux 或 Docker/CI 上运行）
```

产物在 `release/`（`SamsungHealthViz-<version>-<arch>.<ext>`）：

| 平台 | 产物 |
|---|---|
| macOS arm64 | `.dmg`（拖拽安装）/ `.pkg`（装到 `/Applications`）/ `.zip`（免安装） |
| Windows x64 | `.exe`（NSIS，可选安装目录、创建快捷方式）/ `.zip`（便携） |
| Linux x64 | `.AppImage` / `.deb` |
| Android | `SamsungHealthViz-Bridge-<version>.apk`（debug 签名，侧载安装） |

说明：

- 应用图标：macOS `build/icon.icns`，Windows `build/icon.ico`，Linux `build/icon.png`；
- 签名：默认 `mac.identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false`，即**不签名/不公证**；
  `scripts/after-pack.cjs` 只对 macOS `.app` 做 ad-hoc 签名，方便本机直接运行；正式分发请配置 Developer ID / 代码签名证书；
- 未签名产物首次打开可能被 Gatekeeper / SmartScreen 拦截：mac 右键 → 打开，Windows 点「更多信息 → 仍要运行」；
- `build.electronDownload.cache = ".cache/electron"`：Electron 发行包缓存放到项目内（已 gitignore）；
- 国内网络可加镜像（可选）：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm dist:win`。

### 自动更新

已集成 `electron-updater`，从 GitHub Release 检查并更新（`build.publish` 已配置为 GitHub）：

- 应用启动 8 秒后检查一次，之后每 6 小时检查；「设置 → 关于 → 检查更新」可手动检查；
- 增量更新依赖 electron-builder 生成的 `latest*.yml` + `*.blockmap`，CI 发布时一并上传；
- Windows（NSIS）：自动下载并做**差量更新**，完成后提示重启安装；
- Linux（AppImage）：自动下载并更新（支持 blockmap 差量）；deb 版不支持自动更新；
- macOS：Squirrel.Mac 要求校验代码签名，当前构建**未签名**，因此只提示「发现新版本」并打开发布页，不会自动安装；
  配置 Developer ID 签名后可开启自动安装。

发布新版本：改 `package.json` 的 `version` → 新增 `docs/release-notes/vX.Y.Z.md` → 打 tag 推送，
CI 自动构建并发布，已安装的客户端即可检查到更新。

### CI / Docker

本地缺工具链时（例如 Windows 安装包需要 wine/Rosetta，dmg 需要 macOS 的 hdiutil）交给 CI 或 Docker：

**GitHub Actions**（`.github/workflows/build.yml`）：

- 触发：手动触发，或推送 `v*` 版本 tag（推荐：`git tag v0.0.6 && git push origin v0.0.6`）；
- 在 `macos-latest` / `windows-latest` / `ubuntu-latest` 上分别打包，产物以 artifact 上传；
- `android` job 构建手机直传 App 的 debug APK（artifact `android-apk`）；
- 最后的 `release` job 先校验 tag 与 `package.json` 的 `version` 一致，再汇总三平台安装包与 APK，
  自动创建并发布 GitHub Release；
- Release 说明自动读取 `docs/release-notes/<tag>.md`，不存在时回退为自动生成；
- 发布统一走 tag 推送，不要在网页手动创建 Release。

**Docker（任意机器构建 Windows 安装包）**：

```bash
docker build --platform linux/amd64 -f Dockerfile.win -t ridecareer-win .
docker run --rm --platform linux/amd64 -v "$PWD/release:/out" ridecareer-win
```

镜像 `electronuserland/builder:wine` 自带 wine 与 NSIS 工具链，不依赖本机的 Rosetta/wine。
macOS 的 dmg 只能在 macOS 上构建（系统限制）。

## 自检与调试

```bash
pnpm check          # 坐标判定 + 局域网接收器（含「伪造导出包 → 上传 → 真实解析」全链路）
pnpm check:coord    # 只跑坐标判定
pnpm check:lan      # 只跑局域网直传
```

主进程支持一组调试参数（仅用于本机冒烟测试，不影响正式运行）：

| 参数 | 作用 |
|---|---|
| `--user-data=<dir>` | 隔离用户数据目录（缓存 / settings.json），避免污染真实数据 |
| `--window-size=980x720` | 强制主窗口尺寸 |
| `--window-kind=settings` | 主窗口直接渲染设置页（用于截设置窗口布局） |
| `--data=<path>` | 启动后自动解析指定数据包 |
| `--shot=<png>` | 启动后截图并退出（配合下面参数） |
| `--shot-delay=<ms>` | 截图前等待时间（默认 6000） |
| `--shot-page=<hash>` | 截图前跳转到指定路由（如 `/settings`） |
| `--shot-js=<js>` | 截图前在渲染进程执行一段 JS，可返回结果打印到控制台 |
| `--lan-auto` | 启动时直接开启局域网接收器（不开界面也能收手机上传） |

示例（在 `pnpm dev` 起好的 Vite 服务上另开一个实例）：

```bash
VITE_DEV_SERVER_URL=http://localhost:5183/ env -u ELECTRON_RUN_AS_NODE \
  node_modules/.bin/electron . --user-data=.cache/shot-profile --window-kind=settings \
  --window-size=980x720 --shot=.cache/settings.png --shot-delay=5000
```

截图统一使用虚构演示数据，提交前检查不含真实账号、路径、位置与设备信息。
