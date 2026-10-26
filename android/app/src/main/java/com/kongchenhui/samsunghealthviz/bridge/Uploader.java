package com.kongchenhui.samsunghealthviz.bridge;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 第二阶段：把已经打包好的临时 ZIP 整包上传给电脑端。
 *
 * <p>使用固定长度（Content-Length）+ 256 KB 缓冲顺序发送，并带上 SHA-256 供电脑端校验；
 * 不再依赖 SAf 逐文件读取，因此网络阶段是纯 I/O。所有网络操作在工作线程执行，回调切回主线程。</p>
 */
final class Uploader {

    interface Listener {
        /** 已发送字节数、总字节数（固定长度，恒 > 0）、估算速度（字节/秒）。 */
        void onProgress(long sentBytes, long totalBytes, long bytesPerSecond);

        void onSuccess(String fileName, long bytes);

        void onFailure(String message);

        void onCancelled();
    }

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int BUFFER_SIZE = 256 * 1024;
    private static final long UI_INTERVAL_NS = 120L * 1000L * 1000L;
    private static final long SPEED_WINDOW_NS = 300L * 1000L * 1000L;

    private final File file;
    private final String sha256;
    private final String fileName;
    private final String host;
    private final int port;
    private final String token;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private volatile boolean cancelRequested;
    private volatile HttpURLConnection connection;
    private Thread worker;

    Uploader(File file, String sha256, String fileName, String host, int port, String token,
             Listener listener) {
        this.file = file;
        this.sha256 = sha256;
        this.fileName = fileName;
        this.host = host;
        this.port = port;
        this.token = token;
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
        long total = Math.max(1L, file.length());
        try {
            URL url = new URL("http://" + hostForUrl(host) + ":" + port + "/upload");
            conn = (HttpURLConnection) url.openConnection();
            connection = conn;
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setUseCaches(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            // 已知 ZIP 大小：固定长度上传，进度更准确，电脑端也能校验长度
            conn.setFixedLengthStreamingMode(total);
            conn.setRequestProperty("Content-Type", "application/zip");
            conn.setRequestProperty("X-Upload-Token", token);
            conn.setRequestProperty("X-File-Name", encodeURIComponent(fileName));
            if (sha256 != null && !sha256.isEmpty()) {
                conn.setRequestProperty("X-File-SHA256", sha256);
            }
            conn.setRequestProperty("User-Agent", "SamsungHealthVizBridge/1.1 (Android)");

            SpeedMeter meter = new SpeedMeter();
            postProgress(0L, total, 0L);
            long sent = sendFile(conn, total, meter);

            if (cancelRequested) {
                postCancelled();
                return;
            }
            postProgress(sent, total, meter.speed());

            int code = conn.getResponseCode();
            String body = readBody(code >= 400 ? conn.getErrorStream() : conn.getInputStream());

            if (cancelRequested) {
                postCancelled();
                return;
            }
            if (code == 200) {
                String savedName = fileName;
                long savedBytes = sent;
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
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                    // 忽略
                }
            }
        }
    }

    /** 把临时 ZIP 顺序写入请求体，返回已发送字节数。 */
    private long sendFile(HttpURLConnection conn, long total, SpeedMeter meter) throws IOException {
        long sent = 0L;
        long lastUi = 0L;
        try (InputStream in = new FileInputStream(file);
             OutputStream out = conn.getOutputStream()) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (cancelRequested) {
                    throw new IOException("cancelled");
                }
                out.write(buffer, 0, read);
                sent += read;
                meter.add(read);
                long now = System.nanoTime();
                if (now - lastUi >= UI_INTERVAL_NS) {
                    lastUi = now;
                    postProgress(sent, total, meter.speed());
                }
            }
            out.flush();
        }
        return sent;
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
                return "电脑端没有识别出有效的 ZIP 文件（或校验失败）。请重试或重新打包。";
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

    /** 发送速率统计：300 ms 窗口，带平滑。 */
    private static final class SpeedMeter {
        private long markNs = System.nanoTime();
        private long markBytes;
        private long speed;

        void add(long bytes) {
            long now = System.nanoTime();
            long delta = now - markNs;
            if (delta >= SPEED_WINDOW_NS) {
                long instant = (markBytes + bytes) * 1_000_000_000L / Math.max(1L, delta);
                speed = speed == 0L ? instant : (speed * 3L + instant) / 4L;
                markNs = now;
                markBytes = 0L;
            } else {
                markBytes += bytes;
            }
        }

        long speed() {
            if (speed > 0L) {
                return speed;
            }
            return 0L;
        }
    }
}
