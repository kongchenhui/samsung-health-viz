package com.kongchenhui.samsunghealthviz.bridge;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 通过 SAF（DocumentsContract + ContentResolver）访问用户选择的导出目录。
 *
 * <p>不依赖 AndroidX / DocumentFile：只用 {@link DocumentsContract} 构造子文档 URI，
 * 直接用 {@link ContentResolver#query} 与 {@link ContentResolver#openInputStream} 遍历。</p>
 *
 * <p>遍历只读取文档元数据和文件流，不落任何临时文件。</p>
 */
final class ExportTree {

    /** 目录读取失败（授权失效、非文档目录等）时抛出，消息可直接展示给用户。 */
    static final class TreeException extends IOException {
        TreeException(String message) {
            super(message);
        }
    }

    /** 用户取消上传时抛出，用于从深层遍历中快速退出。 */
    static final class CancelledException extends IOException {
        CancelledException() {
            super("cancelled");
        }
    }

    /** 打包进度回调：累计已处理的原始文件字节数。 */
    interface StreamListener {
        void onBytes(long bytes) throws IOException;
    }

    /** 遍历统计结果。 */
    static final class Stats {
        long files;
        long knownBytes;
        boolean hasUnknownSize;
    }

    private static final String[] PROJECTION = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

    private static final int MAX_DEPTH = 64;

    final Uri treeUri;
    final String rootDocId;
    final String rootName;
    final boolean autoDrilled;

    private ExportTree(Uri treeUri, String rootDocId, String rootName, boolean autoDrilled) {
        this.treeUri = treeUri;
        this.rootDocId = rootDocId;
        this.rootName = rootName;
        this.autoDrilled = autoDrilled;
    }

    /**
     * 解析用户选择的目录。若选中的父目录下只有一个 {@code samsunghealth_*} 子目录，
     * 则自动下钻到该子目录（与三星健康导出结构一致）。
     */
    static ExportTree resolve(ContentResolver resolver, Uri treeUri) throws IOException {
        String treeDocId;
        try {
            treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        } catch (RuntimeException e) {
            throw new TreeException("无法识别所选目录，请重新选择三星健康的导出目录。");
        }

        List<Child> children = listChildren(resolver, treeUri, treeDocId);
        if (children.size() == 1) {
            Child only = children.get(0);
            if (only.directory && only.name != null && only.name.startsWith("samsunghealth_")) {
                String name = sanitizeName(only.name);
                if (name != null) {
                    return new ExportTree(treeUri, only.docId, name, true);
                }
            }
        }

        String rootName = sanitizeName(queryDisplayName(resolver, treeUri, treeDocId));
        if (rootName == null) {
            rootName = "samsung-health-export";
        }
        return new ExportTree(treeUri, treeDocId, rootName, false);
    }

    /** 统计文件数量与总字节数（异步执行，供界面展示与进度百分比使用）。 */
    static Stats count(ContentResolver resolver, ExportTree tree) throws IOException {
        Stats stats = new Stats();
        countDir(resolver, tree, tree.rootDocId, stats, 0);
        return stats;
    }

    private static void countDir(ContentResolver resolver, ExportTree tree, String dirDocId,
                                 Stats stats, int depth) throws IOException {
        if (depth > MAX_DEPTH) {
            return;
        }
        for (Child child : listChildren(resolver, tree.treeUri, dirDocId)) {
            if (child.directory) {
                countDir(resolver, tree, child.docId, stats, depth + 1);
            } else {
                stats.files++;
                if (child.size >= 0) {
                    stats.knownBytes += child.size;
                } else {
                    stats.hasUnknownSize = true;
                }
            }
        }
    }

    /**
     * 边遍历边写入 ZIP：第一个条目是导出根目录，其余条目路径为 {@code <root>/...}。
     * 不创建临时 zip 文件。
     */
    static void streamToZip(ContentResolver resolver, ExportTree tree, ZipOutputStream zip,
                            StreamListener listener) throws IOException {
        putDirectoryEntry(zip, tree.rootName, 0L);
        streamDir(resolver, tree, tree.rootDocId, tree.rootName, zip, listener, 0);
    }

    private static void streamDir(ContentResolver resolver, ExportTree tree, String dirDocId,
                                  String pathPrefix, ZipOutputStream zip,
                                  StreamListener listener, int depth) throws IOException {
        if (depth > MAX_DEPTH) {
            return;
        }
        for (Child child : listChildren(resolver, tree.treeUri, dirDocId)) {
            String name = sanitizeName(child.name);
            if (name == null) {
                continue;
            }
            String path = pathPrefix + "/" + name;
            if (child.directory) {
                putDirectoryEntry(zip, path, child.lastModified);
                streamDir(resolver, tree, child.docId, path, zip, listener, depth + 1);
            } else {
                ZipEntry entry = new ZipEntry(path);
                if (child.lastModified > 0L) {
                    entry.setTime(child.lastModified);
                }
                zip.putNextEntry(entry);
                copyFile(resolver, tree.treeUri, child.docId, zip, listener);
                zip.closeEntry();
            }
        }
    }

    private static void putDirectoryEntry(ZipOutputStream zip, String path, long time)
            throws IOException {
        ZipEntry entry = new ZipEntry(path + "/");
        if (time > 0L) {
            entry.setTime(time);
        }
        zip.putNextEntry(entry);
        zip.closeEntry();
    }

    private static void copyFile(ContentResolver resolver, Uri treeUri, String docId,
                                 OutputStream out, StreamListener listener) throws IOException {
        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
        InputStream in;
        try {
            in = resolver.openInputStream(docUri);
        } catch (SecurityException e) {
            throw new TreeException("没有读取所选目录的权限，请重新选择导出目录。");
        } catch (IOException e) {
            throw new TreeException("无法读取导出目录中的文件，请重新选择目录后重试。");
        }
        if (in == null) {
            throw new TreeException("无法读取导出目录中的文件，请重新选择目录后重试。");
        }

        byte[] buffer = new byte[64 * 1024];
        try (InputStream stream = in) {
            while (true) {
                int read;
                try {
                    read = stream.read(buffer);
                } catch (SecurityException e) {
                    throw new TreeException("没有读取所选目录的权限，请重新选择导出目录。");
                } catch (IOException e) {
                    throw new TreeException("读取导出目录失败，请检查文件是否仍可访问。");
                }
                if (read == -1) {
                    break;
                }
                out.write(buffer, 0, read);
                listener.onBytes(read);
            }
        }
    }

    private static List<Child> listChildren(ContentResolver resolver, Uri treeUri, String dirDocId)
            throws IOException {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
        Cursor cursor;
        try {
            cursor = resolver.query(childrenUri, PROJECTION, null, null, null);
        } catch (RuntimeException e) {
            throw new TreeException("无法读取所选目录，请重新选择（授权可能已失效）。");
        }
        if (cursor == null) {
            throw new TreeException("无法读取所选目录，请重新选择（授权可能已失效）。");
        }

        List<Child> children = new ArrayList<>();
        try {
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                if (docId == null) {
                    continue;
                }
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                long size = cursor.isNull(3) ? -1L : cursor.getLong(3);
                long lastModified = cursor.isNull(4) ? 0L : cursor.getLong(4);
                boolean directory = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                children.add(new Child(docId, name, directory, size, lastModified));
            }
        } catch (RuntimeException e) {
            throw new TreeException("无法读取所选目录内容，请重新选择。");
        } finally {
            cursor.close();
        }
        return children;
    }

    private static String queryDisplayName(ContentResolver resolver, Uri treeUri, String docId) {
        try {
            Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
            String[] projection = {DocumentsContract.Document.COLUMN_DISPLAY_NAME};
            try (Cursor cursor = resolver.query(docUri, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    return cursor.getString(0);
                }
            }
        } catch (RuntimeException ignored) {
            // 部分提供方不支持按文档 URI 查询，退回到 tree id 解析
        }
        try {
            String treeId = DocumentsContract.getTreeDocumentId(treeUri);
            int colon = treeId.lastIndexOf(':');
            String tail = colon >= 0 ? treeId.substring(colon + 1) : treeId;
            int slash = tail.lastIndexOf('/');
            return slash >= 0 ? tail.substring(slash + 1) : tail;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    /**
     * 清洗条目名：不允许出现路径分隔符与控制字符；"." 与 ".." 视为非法。
     * 返回 null 表示该条目应跳过。
     */
    static String sanitizeName(String raw) {
        if (raw == null) {
            return null;
        }
        StringBuilder builder = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char ch = raw.charAt(i);
            if (ch == '/' || ch == '\\' || ch == '\u0000' || Character.isISOControl(ch)) {
                builder.append('_');
            } else {
                builder.append(ch);
            }
        }
        String name = builder.toString().trim();
        while (name.endsWith(".")) {
            name = name.substring(0, name.length() - 1).trim();
        }
        if (name.isEmpty() || name.equals(".") || name.equals("..")) {
            return null;
        }
        return name;
    }

    /** 目录项 / 文件项。 */
    static final class Child {
        final String docId;
        final String name;
        final boolean directory;
        final long size;
        final long lastModified;

        Child(String docId, String name, boolean directory, long size, long lastModified) {
            this.docId = docId;
            this.name = name;
            this.directory = directory;
            this.size = size;
            this.lastModified = lastModified;
        }
    }
}
