package com.kongchenhui.samsunghealthviz.bridge;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 通过 SAF（DocumentsContract + ContentResolver）访问用户选择的导出目录。
 *
 * <p>不依赖 AndroidX / DocumentFile：只用 {@link DocumentsContract} 构造子文档 URI，
 * 直接用 {@link ContentResolver#query} 读目录元数据。真正的内容读取与打包在 {@link ZipPacker}。</p>
 */
final class ExportTree {

    /** 目录读取失败（授权失效、非文档目录等）时抛出，消息可直接展示给用户。 */
    static final class TreeException extends IOException {
        TreeException(String message) {
            super(message);
        }
    }

    private static final String[] PROJECTION = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

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

    /** 列出某个目录的子项（仅元数据，不读文件内容）。 */
    static List<Child> listChildren(ContentResolver resolver, Uri treeUri, String dirDocId)
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
