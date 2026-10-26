package com.kongchenhui.samsunghealthviz.bridge;

import android.content.ContentResolver;
import android.net.Uri;
import android.os.StatFs;
import android.provider.DocumentsContract;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.security.DigestOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

/**
 * 两阶段上传的第一步：把 SAF 导出目录并行压缩成临时 ZIP。
 *
 * <p>流水线：单线程遍历目录 → 有界任务队列 → N 个压缩线程（读文件 + CRC32 + deflate level 1）
 * → 有界结果队列 → 单线程按 ZIP 格式写临时文件。压缩在多个核上并行，写盘只做顺序拼装，
 * 网络阶段再整包上传（固定长度）。</p>
 *
 * <p>进度不依赖预先扫描目录（全量扫描本身就很慢），用「已写条目数 + 已读原始字节 + 已写压缩字节」展示。</p>
 */
final class ZipPacker {

    interface Listener {
        void onProgress(long files, long sourceBytes, long zipBytes);

        void onDone(Result result);

        void onError(String message);

        void onCancelled();
    }

    /** 打包结果：临时 ZIP 文件 + 统计 + SHA-256（供电脑端校验）。 */
    static final class Result {
        final File file;
        final long files;
        final long sourceBytes;
        final long zipBytes;
        final long elapsedMs;
        final String sha256;

        Result(File file, long files, long sourceBytes, long zipBytes, long elapsedMs, String sha256) {
            this.file = file;
            this.files = files;
            this.sourceBytes = sourceBytes;
            this.zipBytes = zipBytes;
            this.elapsedMs = elapsedMs;
            this.sha256 = sha256;
        }
    }

    static final class PackException extends IOException {
        PackException(String message) {
            super(message);
        }
    }

    static final class CancelledException extends IOException {
        CancelledException() {
            super("cancelled");
        }
    }

    private static final int MAX_FILE_BYTES = 64 * 1024 * 1024;
    private static final long MIN_FREE_BYTES = 128L * 1024 * 1024;
    private static final int TASK_QUEUE = 256;
    private static final int RESULT_QUEUE = 64;
    private static final long UI_INTERVAL_MS = 150L;

    private final ContentResolver resolver;
    private final ExportTree tree;
    private final File outFile;
    private final int workerCount;
    private final boolean compress;
    private final Listener listener;

    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicReference<IOException> failure = new AtomicReference<>();
    private final AtomicLong packedFiles = new AtomicLong();
    private final AtomicLong sourceBytes = new AtomicLong();
    private final AtomicLong compressedBytes = new AtomicLong();

    private Thread packThread;
    private ExecutorService workers;
    private BlockingQueue<Item> tasks;
    private BlockingQueue<Packed> results;

    ZipPacker(ContentResolver resolver, ExportTree tree, File outFile, int workers, boolean compress,
              Listener listener) {
        this.resolver = resolver;
        this.tree = tree;
        this.outFile = outFile;
        this.workerCount = Math.max(1, Math.min(16, workers));
        this.compress = compress;
        this.listener = listener;
    }

    void start() {
        if (packThread != null) {
            return;
        }
        packThread = new Thread(this::run, "zip-pack");
        packThread.setDaemon(true);
        packThread.start();
    }

    /** 用户取消：置位并打断阻塞中的队列操作。 */
    void cancel() {
        cancelled.set(true);
        Thread t = packThread;
        if (t != null) {
            t.interrupt();
        }
        ExecutorService pool = workers;
        if (pool != null) {
            pool.shutdownNow();
        }
    }

    private void run() {
        final long t0 = System.currentTimeMillis();
        try {
            checkFreeSpace();
            tasks = new ArrayBlockingQueue<>(TASK_QUEUE);
            results = new ArrayBlockingQueue<>(RESULT_QUEUE);
            workers = Executors.newFixedThreadPool(workerCount, newDaemonFactory());

            Thread producer = new Thread(this::produce, "zip-walk");
            producer.setDaemon(true);
            producer.start();
            for (int i = 0; i < workerCount; i++) {
                workers.execute(this::work);
            }

            MessageDigest digest;
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (NoSuchAlgorithmException e) {
                throw new PackException("当前设备不支持 SHA-256 校验。");
            }
            // DigestOutputStream 在写盘的同时计算 SHA-256，省掉打包后再读一遍 ZIP
            try (OutputStream raw = new DigestOutputStream(
                    new BufferedOutputStream(new FileOutputStream(outFile), 256 * 1024), digest)) {
                ZipWriter writer = new ZipWriter(raw);
                writer.addDirectory(tree.rootName, t0);
                int ended = 0;
                long lastUi = 0L;
                while (ended < workerCount) {
                    Packed packed = results.take();
                    if (packed == Packed.END) {
                        ended++;
                        continue;
                    }
                    write(writer, packed);
                    long now = System.currentTimeMillis();
                    if (now - lastUi >= UI_INTERVAL_MS) {
                        lastUi = now;
                        notifyProgress();
                    }
                }
                writer.finish();
                notifyProgress();
            }

            producer.join(500);
            IOException firstError = failure.get();
            if (firstError != null) {
                throw firstError;
            }
            if (cancelled.get()) {
                throw new CancelledException();
            }
            long zipBytes = outFile.length();
            Result result = new Result(outFile, packedFiles.get(), sourceBytes.get(), zipBytes,
                    System.currentTimeMillis() - t0, hex(digest.digest()));
            listener.onDone(result);
        } catch (InterruptedException e) {
            handleFailure(new CancelledException());
        } catch (CancelledException e) {
            handleFailure(e);
        } catch (IOException e) {
            handleFailure(e);
        } catch (RuntimeException e) {
            handleFailure(new PackException("打包失败：" + e.getMessage()));
        } finally {
            ExecutorService pool = workers;
            if (pool != null) {
                pool.shutdownNow();
            }
        }
    }

    private void handleFailure(IOException error) {
        deleteTemp();
        IOException first = failure.get();
        IOException cause = first != null ? first : error;
        if (cancelled.get() || cause instanceof CancelledException) {
            listener.onCancelled();
        } else {
            String message = cause.getMessage();
            listener.onError(message == null || message.isEmpty() ? "打包失败，请重试。" : message);
        }
    }

    private void checkFreeSpace() throws PackException {
        File dir = outFile.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new PackException("无法创建临时目录，请检查手机存储空间。");
        }
        try {
            StatFs stat = new StatFs((dir != null ? dir : new File(".")).getAbsolutePath());
            long free = stat.getAvailableBytes();
            if (free < MIN_FREE_BYTES) {
                throw new PackException("手机存储空间不足（需至少 128 MB 空闲），请清理后重试。");
            }
        } catch (RuntimeException e) {
            // 拿不到空间信息时继续，写盘失败会给出错误
        }
    }

    // ---- 遍历（单线程） ----

    private void produce() {
        try {
            walk(tree.rootDocId, tree.rootName, 0);
        } catch (InterruptedException e) {
            cancelled.set(true);
        } catch (IOException e) {
            failure.compareAndSet(null, e instanceof PackException
                    ? e
                    : new PackException(e.getMessage() == null ? "读取导出目录失败。" : e.getMessage()));
            cancel();
        } catch (RuntimeException e) {
            failure.compareAndSet(null, new PackException("读取导出目录失败，请重新选择。"));
            cancel();
        } finally {
            for (int i = 0; i < workerCount; i++) {
                try {
                    tasks.put(Item.end());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private void walk(String dirDocId, String prefix, int depth) throws IOException, InterruptedException {
        if (depth > 64) {
            return;
        }
        for (ExportTree.Child child : ExportTree.listChildren(resolver, tree.treeUri, dirDocId)) {
            if (cancelled.get()) {
                throw new InterruptedException();
            }
            String name = ExportTree.sanitizeName(child.name);
            if (name == null) {
                continue;
            }
            String path = prefix + "/" + name;
            if (child.directory) {
                walk(child.docId, path, depth + 1);
            } else {
                tasks.put(new Item(child.docId, path, child.size, child.lastModified));
            }
        }
    }

    // ---- 压缩（多线程） ----

    private void work() {
        // 每个 worker 复用 Deflater / CRC32 / 输出缓冲，避免两万多个小文件反复创建 native 对象
        Deflater deflater = compress ? new Deflater(Deflater.BEST_SPEED, true) : null;
        CRC32 crc32 = new CRC32();
        byte[] deflateBuffer = compress ? new byte[64 * 1024] : null;
        try {
            while (true) {
                Item item;
                try {
                    item = tasks.take();
                } catch (InterruptedException e) {
                    return;
                }
                if (item.end) {
                    try {
                        results.put(Packed.END);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return;
                }
                if (cancelled.get()) {
                    return;
                }
                try {
                    Packed packed = pack(item, deflater, crc32, deflateBuffer);
                    results.put(packed);
                } catch (InterruptedException e) {
                    return;
                } catch (IOException e) {
                    failure.compareAndSet(null, e instanceof PackException
                            ? e
                            : new PackException(e.getMessage() == null ? "读取文件失败。" : e.getMessage()));
                    cancel();
                    return;
                } catch (RuntimeException e) {
                    failure.compareAndSet(null, new PackException("压缩文件失败，请重试。"));
                    cancel();
                    return;
                }
            }
        } finally {
            if (deflater != null) {
                deflater.end();
            }
        }
    }

    private Packed pack(Item item, Deflater deflater, CRC32 crc32, byte[] deflateBuffer)
            throws IOException {
        byte[] raw = readAll(item);
        if (raw.length == 0) {
            return Packed.stored(item.path, raw, 0L, 0L, item.time);
        }
        crc32.reset();
        crc32.update(raw);
        long crc = crc32.getValue();

        if (!compress) {
            return Packed.stored(item.path, raw, crc, raw.length, item.time);
        }
        byte[] compressed = deflate(raw, deflater, deflateBuffer);
        if (compressed == null || compressed.length >= raw.length) {
            return Packed.stored(item.path, raw, crc, raw.length, item.time);
        }
        return Packed.deflated(item.path, compressed, crc, raw.length, item.time);
    }

    private byte[] readAll(Item item) throws IOException {
        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree.treeUri, item.docId);
        InputStream in;
        try {
            in = resolver.openInputStream(docUri);
        } catch (SecurityException e) {
            throw new PackException("没有读取所选目录的权限，请重新选择导出目录。");
        }
        if (in == null) {
            throw new PackException("无法读取导出目录中的文件，请重新选择目录后重试。");
        }
        int initial = item.size > 0 && item.size < MAX_FILE_BYTES ? (int) item.size : 16 * 1024;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(initial);
        byte[] chunk = new byte[256 * 1024];
        long total = 0L;
        try (InputStream stream = in) {
            int read;
            while ((read = stream.read(chunk)) != -1) {
                total += read;
                if (total > MAX_FILE_BYTES) {
                    throw new PackException("导出目录里存在过大的文件（> 64 MB），暂时无法打包。");
                }
                buffer.write(chunk, 0, read);
                if (cancelled.get()) {
                    throw new PackException("cancelled");
                }
            }
        } catch (IOException e) {
            if (cancelled.get()) {
                throw new PackException("cancelled");
            }
            throw e;
        }
        return buffer.toByteArray();
    }

    /** 原始 deflate 流（ZIP 条目要求 nowrap=true）。空结果或异常返回 null，调用方退回 STORE。 */
    private static byte[] deflate(byte[] raw, Deflater deflater, byte[] buffer) {
        try {
            deflater.reset();
            deflater.setInput(raw);
            deflater.finish();
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, raw.length / 3));
            while (!deflater.finished()) {
                int written = deflater.deflate(buffer);
                if (written <= 0) {
                    break;
                }
                out.write(buffer, 0, written);
            }
            return out.toByteArray();
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ---- 写 ZIP（单线程） ----

    private void write(ZipWriter writer, Packed packed) throws IOException {
        if (packed.method == 8) {
            writer.addDeflated(packed.path, packed.data, packed.crc, packed.usize, packed.time);
        } else {
            writer.addStored(packed.path, packed.data, packed.crc, packed.time);
        }
        packedFiles.incrementAndGet();
        sourceBytes.addAndGet(packed.usize);
        compressedBytes.addAndGet(packed.data.length);
    }

    private void notifyProgress() {
        listener.onProgress(packedFiles.get(), sourceBytes.get(), compressedBytes.get());
    }

    // ---- 工具 ----

    private static ThreadFactory newDaemonFactory() {
        AtomicInteger index = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, "zip-worker-" + index.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            builder.append(String.format(Locale.US, "%02x", b));
        }
        return builder.toString();
    }

    private void deleteTemp() {
        try {
            //noinspection ResultOfMethodCallIgnored
            outFile.delete();
        } catch (RuntimeException ignored) {
            // 忽略
        }
    }

    /** 待压缩条目 / 结束标记。 */
    private static final class Item {
        final String docId;
        final String path;
        final long size;
        final long time;
        final boolean end;

        private Item(String docId, String path, long size, long time) {
            this.docId = docId;
            this.path = path;
            this.size = size;
            this.time = time;
            this.end = false;
        }

        private Item() {
            this.docId = null;
            this.path = null;
            this.size = 0L;
            this.time = 0L;
            this.end = true;
        }

        static Item end() {
            return new Item();
        }
    }

    /** 压缩完成的条目（或结束标记）。 */
    private static final class Packed {
        static final Packed END = new Packed();
        final String path;
        final int method;
        final byte[] data;
        final long crc;
        final long usize;
        final long time;
        final boolean end;

        private Packed(String path, int method, byte[] data, long crc, long usize, long time) {
            this.path = path;
            this.method = method;
            this.data = data;
            this.crc = crc;
            this.usize = usize;
            this.time = time;
            this.end = false;
        }

        private Packed() {
            this.path = null;
            this.method = 0;
            this.data = null;
            this.crc = 0L;
            this.usize = 0L;
            this.time = 0L;
            this.end = true;
        }

        static Packed stored(String path, byte[] data, long crc, long usize, long time) {
            return new Packed(path, 0, data, crc, usize, time);
        }

        static Packed deflated(String path, byte[] data, long crc, long usize, long time) {
            return new Packed(path, 8, data, crc, usize, time);
        }
    }
}
