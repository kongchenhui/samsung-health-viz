package com.kongchenhui.samsunghealthviz.bridge;

import android.content.ContentResolver;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.zip.ZipOutputStream;

/**
 * 把选中的导出目录边遍历边打包成 ZIP，并通过 HTTP POST 传给同一局域网内的电脑端。
 *
 * <p>使用 {@link HttpURLConnection} + chunked 流式上传，全程不落临时 zip 文件；
 * 所有网络操作都在工作线程执行，回调切回主线程。</p>
 */
final class Uploader {

    interface Listener {
        /** 已处理（打包）的原始字节数、总字节数（可能为 0 表示未知）、估算速度（字节/秒）。 */
        void onProgress(long sentBytes, long totalBytes, long bytesPerSecond);

        void onSuccess(String fileName, long bytes);

        void onFailure(String message);

        void onCancelled();
    }

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final long UI_INTERVAL_NS = 120L * 1000L * 1000L;

    private final ContentResolver resolver;
    private final ExportTree tree;
    private final String host;
    private final int port;
    private final String token;
    private final long totalBytes;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private volatile boolean cancelRequested;
    private volatile HttpURLConnection connection;
    private Thread worker;

    Uploader(ContentResolver resolver, ExportTree tree, String host, int port, String token,
             long totalBytes, Listener listener) {
        this.resolver = resolver;
        this.tree = tree;
        this.host = host;
        this.port = port;
        this.token = token;
        this.totalBytes = Math.max(0L, totalBytes);
        this.listener = listener;
    }

    void start() {
        if (worker != null) {
            return;
        }
        worker = new Thread(this::run, "lan-upload");
        worker.setDaemon(true);
        worker.start();
    }

    /** 用户取消：置位并断开连接，让阻塞中的写操作尽快失败。 */
    void cancel() {
        cancelRequested = true;
        HttpURLConnection c = connection;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 忽略
            }
        }
    }

    private void run() {
        HttpURLConnection conn = null;
        ZipOutputStream zip = null;
        try {
            if (cancelRequested) {
                postCancelled();
                return;
            }
            String fileName = buildFileName(tree.rootName);
            URL url = new URL("http://" + hostForUrl(host) + ":" + port + "/upload");
            conn = (HttpURLConnection) url.openConnection();
            connection = conn;
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setUseCaches(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            // chunked 流式上传：不预知 ZIP 大小，也不需要落临时文件
            conn.setChunkedStreamingMode(BUFFER_SIZE);
            conn.setRequestProperty("Content-Type", "application/zip");
            conn.setRequestProperty("X-Upload-Token", token);
            conn.setRequestProperty("X-File-Name", encodeURIComponent(fileName));
            conn.setRequestProperty("User-Agent", "SamsungHealthVizBridge/1.0 (Android)");

            final long total = totalBytes;
            postProgress(0L, total, 0L);

            ProgressSink sink = new ProgressSink();
            OutputStream rawOutput = conn.getOutputStream();
            zip = new ZipOutputStream(new BufferedOutputStream(rawOutput, BUFFER_SIZE),
                    StandardCharsets.UTF_8);
            ExportTree.streamToZip(resolver, tree, zip, sink);
            zip.finish();
            zip.flush();
            zip.close();
            zip = null;

            if (cancelRequested) {
                postCancelled();
                return;
            }
            postProgress(sink.sent, total, sink.speed());

            int code = conn.getResponseCode();
            String body = readBody(code >= 400 ? conn.getErrorStream() : conn.getInputStream());

            if (cancelRequested) {
                postCancelled();
                return;
            }
            if (code == 200) {
                String savedName = fileName;
                long savedBytes = sink.sent;
                try {
                    JSONObject json = new JSONObject(body);
                    if (json.optBoolean("ok", false)) {
                        String reported = json.optString("file", "");
                        if (!reported.isEmpty()) {
                            savedName = reported;
                        }
                        savedBytes = json.optLong("bytes", savedBytes);
                    }
                } catch (Exception ignored) {
                    // 200 但响应体不规范时，按成功处理
                }
                final String finalName = savedName;
                final long finalBytes = savedBytes;
                main.post(() -> listener.onSuccess(finalName, finalBytes));
                return;
            }

            final String message = messageForCode(code);
            main.post(() -> listener.onFailure(message));
        } catch (ExportTree.CancelledException e) {
            postCancelled();
        } catch (ExportTree.TreeException e) {
            final String message = e.getMessage() == null
                    ? "读取导出目录失败，请重新选择后重试。"
                    : e.getMessage();
            main.post(() -> listener.onFailure(message));
        } catch (IOException e) {
            if (cancelRequested) {
                postCancelled();
                return;
            }
            int code = peekResponseCode(conn);
            final String message = code >= 400 ? messageForCode(code) : networkMessage();
            main.post(() -> listener.onFailure(message));
        } catch (Exception e) {
            if (cancelRequested) {
                postCancelled();
                return;
            }
            int code = peekResponseCode(conn);
            final String message = code >= 400 ? messageForCode(code) : "上传中断，请稍后重试。";
            main.post(() -> listener.onFailure(message));
        } finally {
            connection = null;
            if (zip != null) {
                try {
                    zip.close();
                } catch (Exception ignored) {
                    // 忽略
                }
            }
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                    // 忽略
                }
            }
        }
    }

    private void postProgress(final long sent, final long total, final long bps) {
        main.post(() -> listener.onProgress(sent, total, bps));
    }

    private void postCancelled() {
        main.post(() -> listener.onCancelled());
    }

    private String networkMessage() {
        return "无法连接电脑 " + host + ":" + port
                + "。请确认手机与电脑在同一 Wi-Fi、电脑端已开启接收，并已放行防火墙。";
    }

    /** 按协议把 HTTP 状态码映射成用户可读的中文提示（不含路径 / 账号信息）。 */
    static String messageForCode(int code) {
        switch (code) {
            case 400:
                return "电脑端没有识别出有效的 ZIP 文件。请确认选择的是三星健康导出的目录后重试。";
            case 401:
                return "令牌不正确。请检查电脑端界面上显示的 6 位令牌后重试。";
            case 409:
                return "电脑端正忙（已有另一个上传在进行），请稍等几秒后重试。";
            case 413:
                return "导出包超过 2 GiB，电脑端拒绝接收。";
            case 429:
                return "尝试次数过多，请稍等片刻后再试。";
            default:
                if (code >= 500) {
                    return "电脑端处理失败（HTTP " + code + "），请查看电脑端后重试。";
                }
                return "上传失败（HTTP " + code + "）。";
        }
    }

    /** 健康检查：返回 null 表示电脑端可用，否则返回可读错误信息。 */
    static String checkHealth(String host, int port) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("http://" + hostForUrl(host) + ":" + port + "/health");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setUseCaches(false);
            int code = conn.getResponseCode();
            if (code == 200) {
                String body = readBody(conn.getInputStream());
                try {
                    JSONObject json = new JSONObject(body);
                    if (json.optBoolean("ok", false)) {
                        return null;
                    }
                } catch (Exception ignored) {
                    // 继续走下面的提示
                }
                return "电脑端响应异常，请确认电脑端版本与 App 匹配。";
            }
            return "电脑端返回 HTTP " + code + "，请确认电脑端接收器已启动。";
        } catch (Exception e) {
            return "无法连接电脑 " + host + ":" + port
                    + "。请确认手机与电脑在同一 Wi-Fi、电脑端已开启接收，并已放行防火墙。";
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                    // 忽略
                }
            }
        }
    }

    /**
     * 上传文件名规则（协议第 4 节）：目录名匹配 {@code samsunghealth_<数字>_<14位时间戳>} 时
     * 原样加 .zip，否则使用 {@code samsung-health-export-<yyyyMMddHHmmss>.zip}。
     */
    static String buildFileName(String rootName) {
        String base = rootName == null ? "" : rootName;
        if (base.matches("samsunghealth_\\d+_\\d{14}")) {
            return base + ".zip";
        }
        String stamp = new SimpleDateFormat("yyyyMMddHHmmss", Locale.US).format(new Date());
        return "samsung-health-export-" + stamp + ".zip";
    }

    /** 等价于 JavaScript 的 encodeURIComponent（UTF-8 百分号编码）。 */
    static String encodeURIComponent(String value) {
        if (value == null) {
            return "";
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        StringBuilder builder = new StringBuilder(bytes.length * 3);
        for (byte raw : bytes) {
            int c = raw & 0xFF;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '!' || c == '~'
                    || c == '*' || c == '\'' || c == '(' || c == ')') {
                builder.append((char) c);
            } else {
                builder.append('%')
                        .append(Character.toUpperCase(Character.forDigit((c >> 4) & 0xF, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xF, 16)));
            }
        }
        return builder.toString();
    }

    /** IPv6 字面量需要在 URL 中加方括号。 */
    static String hostForUrl(String host) {
        if (host == null) {
            return "";
        }
        String trimmed = host.trim();
        if (trimmed.isEmpty() || trimmed.startsWith("[") || trimmed.indexOf(':') < 0) {
            return trimmed;
        }
        return "[" + trimmed + "]";
    }

    private static int peekResponseCode(HttpURLConnection conn) {
        if (conn == null) {
            return -1;
        }
        try {
            return conn.getResponseCode();
        } catch (Exception e) {
            return -1;
        }
    }

    private static String readBody(InputStream in) {
        if (in == null) {
            return "";
        }
        try (InputStream stream = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[2048];
            int read;
            while ((read = stream.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                if (buffer.size() >= 8192) {
                    break;
                }
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /** 统计打包进度并节流回调，顺便检查取消。 */
    private final class ProgressSink implements ExportTree.StreamListener {
        private long sent;
        private long lastUiNs;
        private long speedMarkNs = System.nanoTime();
        private long speedMarkBytes;
        private long speed;

        long sent() {
            return sent;
        }

        long speed() {
            return speed;
        }

        @Override
        public void onBytes(long bytes) throws IOException {
            sent += bytes;
            if (cancelRequested) {
                throw new ExportTree.CancelledException();
            }
            long now = System.nanoTime();
            if (now - lastUiNs >= UI_INTERVAL_NS) {
                lastUiNs = now;
                updateSpeed(now);
                postProgress(sent, totalBytes, speed);
            }
        }

        private void updateSpeed(long now) {
            long deltaNs = now - speedMarkNs;
            if (deltaNs >= 300_000_000L) {
                long deltaBytes = sent - speedMarkBytes;
                long instant = deltaBytes * 1_000_000_000L / deltaNs;
                speed = speed == 0L ? instant : (speed * 3L + instant) / 4L;
                speedMarkNs = now;
                speedMarkBytes = sent;
            }
        }
    }
}
