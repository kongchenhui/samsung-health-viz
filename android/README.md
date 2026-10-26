# Samsung Health 直传（Android App）

纯 Java、无第三方依赖（不使用 AndroidX）的 Android 客户端：
选择三星健康导出目录 → 遍历目录并流式打包成 ZIP → 在**同一 Wi-Fi** 内通过 HTTP 直传电脑端的 Electron 应用。

传输协议见 [`../docs/lan-upload-protocol.md`](../docs/lan-upload-protocol.md)。

## 功能

- **自动发现**：监听桌面端每 3 秒一次的 UDP 8738 广播，电脑 IP 取数据包来源地址，
  HTTP 端口取包内 `httpPort` 字段；发现失败可手动输入 IP / 端口（默认 `8737`）。
- **6 位数字令牌**：填入电脑端界面上显示的令牌，仅随请求头发送，不保存到手机。
- **选择导出目录**：`ACTION_OPEN_DOCUMENT_TREE`（SAF）+ 持久化授权，无需存储权限；
  若选中的父目录下只有一个 `samsunghealth_*` 子目录，自动进入该子目录。
- **边遍历边打包**：用 `ZipOutputStream` 直接写入网络流，不生成临时 ZIP 文件；
  ZIP 顶层目录为导出根目录名，与三星官方导出结构一致。
- **上传进度**：显示百分比、已发送 / 总大小、实时速度，支持取消；上传期间屏幕常亮。
- **错误提示**：按协议处理 `200 / 400 / 401 / 409 / 413 / 429` 与网络异常，提示可读，
  不含账号信息与目录绝对路径。
- **记住地址**：SharedPreferences 保存上次的 IP / 端口（不保存令牌）。

## 构建

环境要求：

- JDK 17
- Android SDK：`platforms;android-34`、`build-tools;34.0.0`（`ANDROID_HOME` 指向 SDK 根目录）
- Gradle 8.7（由 `gradlew` 自动下载）+ Android Gradle Plugin 8.5.2

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk

# 如访问 Google Maven / Gradle 发行版需要代理：
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 \
  -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

cd android
./gradlew --no-daemon assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`（debug 签名，可直接安装）。

首次构建需要联网下载 Gradle 8.7 发行版与 AGP 依赖；之后可离线构建。
也可以把 SDK 路径写进 `android/local.properties`（`sdk.dir=/path/to/android-sdk`），
该文件已被 `.gitignore` 忽略，**不要提交**。

## 安装到手机

- 通过 adb：`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
- 或把 APK 传到手机，用文件管理器打开安装（系统会要求允许「安装未知来源应用」）。

本 App 只申请 `INTERNET` 权限；选择目录走系统文件选择器（SAF），不需要存储权限。

## 与电脑端配合使用

1. 电脑和手机连接**同一个 Wi-Fi / 局域网**（访客网络或开启了 AP 隔离时无法互传）。
2. 打开电脑端的接收器界面，确认界面显示了 6 位令牌。
3. 手机 App 点「搜索电脑」自动发现；若网络屏蔽广播，则手动填写电脑 IP 与端口（默认 `8737`），
   点「测试连接」验证连通性。
4. 填写令牌，点「选择目录」选择三星健康导出目录。
5. 点「开始上传」，等待进度到 100% 后电脑端会自动解析并刷新界面。

### 电脑端防火墙需放行

电脑端需要监听两个端口，首次使用请在系统防火墙中放行：

| 端口 | 协议 | 用途 |
|---|---|---|
| 8737 | TCP | 上传（HTTP `/upload`、`/health`） |
| 8738 | UDP | 自动发现广播 |

- macOS：若系统弹出「是否允许接受传入网络连接」，请选择允许；也可在「系统设置 → 网络 → 防火墙」中放行。
- Windows：在「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」中放行，或为上述端口添加入站规则。

## 已知限制

- 仅使用明文 HTTP（协议要求），请只在可信局域网内使用。
- 单个导出包上限 2 GiB（由电脑端限制）。
- 目录授权基于 SAF，部分第三方文件管理器不授予长期权限，重新打开 App 后可能需要再选一次目录。
- `targetSdk 34`：明文流量通过 `android:usesCleartextTraffic="true"` 显式允许；目录访问全部走 SAF。
- 本项目构建环境中没有真机 / 模拟器，只验证到 APK 构建与静态检查，安装与真机联调需在设备上完成。

## 隐私

- App 不采集、不上传账号信息；令牌只用于请求头，不写入磁盘。
- 界面只显示所选目录的显示名，不展示、不记录绝对路径；日志中不打印文件名与健康数据。
- 上传只在局域网内进行；电脑端只保留最近一次上传的 ZIP，用户可在电脑端清除。
