package com.kongchenhui.samsunghealthviz.bridge;

import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * 极简 ZIP 写入器：接收「已压缩好的 deflate 数据」，按 ZIP 格式写本地文件头、数据、中央目录。
 *
 * <p>为什么不用 {@link java.util.zip.ZipOutputStream}：后者要求写入未压缩数据并自己压缩，
 * 无法把多线程并行压缩好的结果直接装进 ZIP。手写写入器后，压缩可以在多个线程并行完成，
 * 单写线程只做顺序拼装，压缩速度随 CPU 核数提升。</p>
 *
 * <p>纯 Java、无 Android 依赖，便于用 JDK 单独做格式自检。</p>
 *
 * <p>限制：条目数 &lt; 65535、单文件与总大小 &lt; 4 GiB；不写 ZIP64（导出包远小于该限制）。</p>
 */
final class ZipWriter implements Closeable {

    private static final int SIG_LOCAL = 0x04034b50;
    private static final int SIG_CENTRAL = 0x02014b50;
    private static final int SIG_EOCD = 0x06054b50;
    private static final int FLAG_UTF8 = 0x0800; // bit 11：文件名按 UTF-8 编码
    private static final int METHOD_STORE = 0;
    private static final int METHOD_DEFLATE = 8;
    private static final int VERSION = 20;

    private static final class Entry {
        final String name;
        final int method;
        final long crc;
        final long compressedSize;
        final long uncompressedSize;
        final int dosTime;
        final int dosDate;
        final long offset;

        Entry(String name, int method, long crc, long compressedSize, long uncompressedSize,
              int dosTime, int dosDate, long offset) {
            this.name = name;
            this.method = method;
            this.crc = crc;
            this.compressedSize = compressedSize;
            this.uncompressedSize = uncompressedSize;
            this.dosTime = dosTime;
            this.dosDate = dosDate;
            this.offset = offset;
        }
    }

    private final OutputStream out;
    private final List<Entry> entries = new ArrayList<>();
    private long offset;
    private boolean finished;

    ZipWriter(OutputStream out) {
        this.out = out;
    }

    /** 目录条目（STORE，0 字节）。name 会自动补结尾的 "/"。 */
    void addDirectory(String name, long epochMs) throws IOException {
        String path = name.endsWith("/") ? name : name + "/";
        addEntry(path, METHOD_STORE, 0L, 0L, 0L, epochMs);
    }

    /**
     * 添加一个已经是 deflate 压缩数据的文件条目。
     *
     * @param compressed       原始 deflate 流（nowrap，即不含 zlib 头）
     * @param crc              原始数据的 CRC32
     * @param uncompressedSize 原始数据大小
     */
    void addDeflated(String name, byte[] compressed, long crc, long uncompressedSize, long epochMs)
            throws IOException {
        addEntry(name, METHOD_DEFLATE, crc, compressed.length, uncompressedSize, epochMs);
        out.write(compressed);
        offset += compressed.length;
    }

    /** 添加一个不压缩的条目（小文件或空文件用，避免空 deflate 流的兼容问题）。 */
    void addStored(String name, byte[] data, long crc, long epochMs) throws IOException {
        addEntry(name, METHOD_STORE, crc, data.length, data.length, epochMs);
        out.write(data);
        offset += data.length;
    }

    private void addEntry(String name, int method, long crc, long compressedSize, long uncompressedSize,
                          long epochMs) throws IOException {
        if (finished) {
            throw new IOException("ZipWriter already finished");
        }
        if (entries.size() >= 65535) {
            throw new IOException("ZIP 条目数超过 65535，无法写入");
        }
        final byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        if (nameBytes.length > 0xFFFF) {
            throw new IOException("ZIP 条目名过长");
        }
        final int[] dt = dosDateTime(epochMs);

        writeInt(SIG_LOCAL);
        writeShort(VERSION);
        writeShort(FLAG_UTF8);
        writeShort(method);
        writeShort(dt[1]);
        writeShort(dt[0]);
        writeInt((int) crc);
        writeInt((int) compressedSize);
        writeInt((int) uncompressedSize);
        writeShort(nameBytes.length);
        writeShort(0); // extra field length
        out.write(nameBytes);

        entries.add(new Entry(name, method, crc, compressedSize, uncompressedSize,
                dt[1], dt[0], offset));
        offset += 30L + nameBytes.length;
    }

    /** 写中央目录与 EOCD，然后 flush（不关闭底层流，由调用方负责）。 */
    void finish() throws IOException {
        if (finished) {
            return;
        }
        finished = true;
        final long centralStart = offset;
        for (Entry e : entries) {
            byte[] nameBytes = e.name.getBytes(StandardCharsets.UTF_8);
            writeInt(SIG_CENTRAL);
            writeShort(VERSION);       // version made by
            writeShort(VERSION);       // version needed
            writeShort(FLAG_UTF8);
            writeShort(e.method);
            writeShort(e.dosTime);
            writeShort(e.dosDate);
            writeInt((int) e.crc);
            writeInt((int) e.compressedSize);
            writeInt((int) e.uncompressedSize);
            writeShort(nameBytes.length);
            writeShort(0);             // extra
            writeShort(0);             // comment
            writeShort(0);             // disk number start
            writeShort(0);             // internal attrs
            writeInt(0);               // external attrs
            writeInt((int) e.offset);  // local header offset
            out.write(nameBytes);
            offset += 46L + nameBytes.length;
        }
        final long centralSize = offset - centralStart;

        writeInt(SIG_EOCD);
        writeShort(0); // disk
        writeShort(0); // central dir disk
        writeShort(entries.size());
        writeShort(entries.size());
        writeInt((int) centralSize);
        writeInt((int) centralStart);
        writeShort(0); // comment length
        out.flush();
    }

    /** DOS 时间（本地时区）。返回 {date, time}。 */
    static int[] dosDateTime(long epochMs) {
        Calendar cal = Calendar.getInstance(Locale.US);
        if (epochMs > 0L) {
            cal.setTimeInMillis(epochMs);
        }
        int year = Math.max(1980, cal.get(Calendar.YEAR));
        int date = ((year - 1980) << 9)
                | ((cal.get(Calendar.MONTH) + 1) << 5)
                | cal.get(Calendar.DAY_OF_MONTH);
        int time = (cal.get(Calendar.HOUR_OF_DAY) << 11)
                | (cal.get(Calendar.MINUTE) << 5)
                | (cal.get(Calendar.SECOND) / 2);
        return new int[]{date, time};
    }

    private void writeShort(int value) throws IOException {
        out.write(value & 0xFF);
        out.write((value >>> 8) & 0xFF);
    }

    private void writeInt(int value) throws IOException {
        out.write(value & 0xFF);
        out.write((value >>> 8) & 0xFF);
        out.write((value >>> 16) & 0xFF);
        out.write((value >>> 24) & 0xFF);
    }

    @Override
    public void close() throws IOException {
        finish();
    }
}
