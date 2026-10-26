# 手机 → 电脑 局域网直传协议（v1）

Android App「Samsung Health Viz 直传」把选中的三星健康导出目录打包成 ZIP，直接上传给同一局域网内运行的桌面端。
桌面端收到后自动解析、更新缓存，无需手动拷文件。

```
手机 App                         电脑（Electron 主进程）
  │  ① UDP 广播发现（8738）  ←────  每 3s 广播一次 {"app":"samsung-health-viz","protocol":1,"httpPort":8737}
  │  ② GET /health           ────→  探测服务是否在跑
  │  ③ POST /upload (ZIP)    ────→  保存 → 解析 → 推送进度
```

## 1. 发现（可选，仅用于自动填地址）

- 桌面端在接收器启动期间，每 3 秒向 `255.255.255.255:8738` 发一次 UTF-8 JSON：
  `{"app":"samsung-health-viz","protocol":1,"httpPort":<端口>,"name":"<主机名>"}`
- 手机 App 监听 UDP 8738，用**数据包来源地址**作为电脑 IP（不信任包内字段），端口取 `httpPort`。
- 手机 App 必须保留手动输入 IP / 端口的入口，发现失败也能用。

## 2. 健康检查

```
GET /health
→ 200 application/json
{"ok":true,"app":"samsung-health-viz","protocol":1}
```

## 3. 上传

```
POST /upload
X-Upload-Token: 123456            # 桌面端界面上显示的 6 位数字，每次启动重新生成
X-File-Name: samsunghealth_%3C...%3E.zip   # encodeURIComponent(文件名)，可省略
Content-Type: application/zip
（可以是 chunked，不要求 Content-Length）
```

- 请求体就是完整 ZIP 文件（可 ZIP64）。ZIP 内**必须有一个顶层目录**（即导出根目录，例如
  `samsunghealth_xxx_20260101000000/`），其余文件在该目录下用 `/` 分隔。
- 电脑端把文件保存到应用数据目录的 `uploads/` 下，文件名做白名单清洗（`[A-Za-z0-9._-]`，最长 80 字符，
  强制 `.zip` 后缀），保留最近一次上传。
- 上传完成后电脑端自动解析，并把结果推给界面（无需手机端再做任何事）。

响应：

| 状态 | 含义 |
|---|---|
| `200 {"ok":true,"file":"<文件名>","bytes":123}` | 已接收，开始解析 |
| `401 {"ok":false,"error":"bad-token"}` | 令牌不对 |
| `400 {"ok":false,"error":"bad-file"}` | 内容不是 ZIP / 文件名为空 |
| `409 {"ok":false,"error":"busy"}` | 已有上传在进行 |
| `413 {"ok":false,"error":"too-large"}` | 超过 2 GiB |
| `429 {"ok":false,"error":"too-many-attempts"}` | 失败次数过多，稍后再试 |

## 4. 手机端行为约定

- 选目录：`ACTION_OPEN_DOCUMENT_TREE`（SAF），持久化授权，遍历得到文件清单。
- 若选中的是「Samsung Health」父目录且里面只有一个 `samsunghealth_*` 子目录，自动进入该子目录。
- ZIP 条目前缀 = 导出根目录名（与三星官方导出 ZIP 的结构一致，桌面端解析会剥掉这一层）。
- 上传文件名：目录名匹配 `samsunghealth_<数字>_<14位时间戳>` 时原样加 `.zip`，
  否则用 `samsung-health-export-<yyyyMMddHHmmss>.zip`；不要把本机绝对路径写进文件名。
- 上传中显示百分比、已发送/总大小、速度，允许取消；屏幕保持常亮。

## 5. 隐私与安全

- 只在局域网内通信，明文 HTTP；令牌只防误传（不承担强认证）。
- 手机端不保存、不上传任何令牌/账号信息；桌面端令牌只在内存中，随进程重启失效。
- 数据只写本机 `uploads/` 目录并在解析后保留最新一份，用户可在界面中清除。
- 不要在日志里打印完整文件路径、手机号或导出目录名。
