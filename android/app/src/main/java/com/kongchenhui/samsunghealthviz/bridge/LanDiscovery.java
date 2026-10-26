package com.kongchenhui.samsunghealthviz.bridge;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 监听桌面端每 3 秒发一次的 UDP 广播（端口 8738），发现同一局域网内的电脑。
 *
 * <p>按协议规定，电脑 IP 取自数据包的来源地址，而不是包内字段；端口取包内的 httpPort。</p>
 */
final class LanDiscovery {

    static final int DISCOVERY_PORT = 8738;
    private static final String EXPECTED_APP = "samsung-health-viz";

    interface Listener {
        void onFound(String ip, int httpPort, String hostName);

        void onFinished(boolean found, String message);
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile boolean stopped;
    private volatile DatagramSocket socket;
    private Thread thread;

    void start(long timeoutMs, Listener listener) {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        thread = new Thread(() -> listen(timeoutMs, listener), "lan-discovery");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        stopped = true;
        running.set(false);
        DatagramSocket current = socket;
        if (current != null) {
            try {
                current.close();
            } catch (Exception ignored) {
                // 忽略
            }
        }
    }

    private void listen(long timeoutMs, Listener listener) {
        DatagramSocket local = null;
        boolean found = false;
        String error = null;
        try {
            local = new DatagramSocket(null);
            local.setReuseAddress(true);
            local.bind(new InetSocketAddress(DISCOVERY_PORT));
            local.setSoTimeout(400);
            socket = local;

            byte[] buffer = new byte[2048];
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (running.get() && System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    local.receive(packet);
                } catch (SocketTimeoutException e) {
                    continue;
                } catch (IOException e) {
                    // 通常是 stop() 关闭了 socket
                    break;
                }
                String json = new String(packet.getData(), packet.getOffset(), packet.getLength(),
                        StandardCharsets.UTF_8).trim();
                Parsed parsed = parse(json);
                if (parsed == null) {
                    continue;
                }
                String ip = packet.getAddress() == null
                        ? null : packet.getAddress().getHostAddress();
                if (ip == null) {
                    continue;
                }
                if (ip.startsWith("::ffff:")) {
                    ip = ip.substring(7);
                }
                final String foundIp = ip;
                final int foundPort = parsed.httpPort;
                final String hostName = parsed.name;
                found = true;
                main.post(() -> listener.onFound(foundIp, foundPort, hostName));
                running.set(false);
                break;
            }
        } catch (IOException e) {
            if (!stopped) {
                error = "无法监听 UDP " + DISCOVERY_PORT + " 端口，可能是其他应用占用了端口。请手动输入电脑 IP。";
            }
        } catch (RuntimeException e) {
            if (!stopped) {
                error = "自动发现电脑失败，请手动输入电脑 IP 和端口。";
            }
        } finally {
            socket = null;
            if (local != null) {
                try {
                    local.close();
                } catch (Exception ignored) {
                    // 忽略
                }
            }
        }

        if (stopped) {
            return;
        }
        final boolean foundFinal = found;
        final String errorFinal = error == null && !found
                ? "没有发现电脑广播。请确认电脑端已开启接收、手机与电脑在同一 Wi-Fi，或手动输入电脑 IP。"
                : error;
        running.set(false);
        main.post(() -> listener.onFinished(foundFinal, errorFinal));
    }

    private static Parsed parse(String json) {
        try {
            JSONObject object = new JSONObject(json);
            if (!EXPECTED_APP.equals(object.optString("app", ""))) {
                return null;
            }
            if (object.optInt("protocol", 0) < 1) {
                return null;
            }
            int port = object.optInt("httpPort", -1);
            if (port <= 0 || port > 65535) {
                return null;
            }
            return new Parsed(port, object.optString("name", ""));
        } catch (Exception e) {
            return null;
        }
    }

    private static final class Parsed {
        final int httpPort;
        final String name;

        Parsed(int httpPort, String name) {
            this.httpPort = httpPort;
            this.name = name;
        }
    }
}
