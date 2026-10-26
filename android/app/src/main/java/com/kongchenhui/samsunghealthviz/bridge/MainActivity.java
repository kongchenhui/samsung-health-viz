package com.kongchenhui.samsunghealthviz.bridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 单 Activity 的局域网直传界面：
 * 选三星健康导出目录 → 打包 ZIP → 通过局域网 HTTP 直传电脑端。
 *
 * <p>UI 全部用代码构建（深色主题），不依赖 AndroidX / 第三方库。</p>
 */
public final class MainActivity extends Activity {

    // ---- 偏好设置（只记住 IP / 端口与上次目录授权，不保存令牌） ----
    private static final String PREFS_NAME = "bridge";
    private static final String PREF_IP = "last_ip";
    private static final String PREF_PORT = "last_port";
    private static final String PREF_TREE = "last_tree_uri";
    private static final String PREF_COMPRESS = "compress_zip";
    private static final int DEFAULT_PORT = 8737;
    private static final int REQUEST_PICK_DIR = 41;
    private static final long SCAN_TIMEOUT_MS = 12_000L;

    // ---- 深色配色 ----
    private static final int C_BG = 0xFF101413;
    private static final int C_SURFACE = 0xFF191F1D;
    private static final int C_FIELD = 0xFF111614;
    private static final int C_STROKE = 0xFF2B3531;
    private static final int C_TEXT = 0xFFE9EEEC;
    private static final int C_TEXT_DIM = 0xFF9AA6A1;
    private static final int C_ACCENT = 0xFF23D18B;
    private static final int C_ON_ACCENT = 0xFF08130E;
    private static final int C_WARN = 0xFFFFC857;
    private static final int C_ERROR = 0xFFFF7A7A;

    private static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    private static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    private enum StatusKind {
        NORMAL, OK, WARN, ERROR
    }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService background = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs;
    private volatile boolean destroyed;
    private boolean analyzing;
    private boolean packing;
    private boolean uploading;

    private ExportTree tree;
    private ZipPacker packer;
    private ZipPacker.Result packed;
    private boolean cancelRequested;
    private long uploadStartedAt;

    private EditText ipField;
    private CheckBox compressCheck;
    private EditText portField;
    private EditText tokenField;
    private TextView connState;
    private TextView dirInfo;
    private TextView statusText;
    private TextView progressText;
    private ProgressBar progressBar;
    private Button scanButton;
    private Button testButton;
    private Button pickButton;
    private Button uploadButton;
    private Button cancelButton;
    private LinearLayout progressGroup;

    private LanDiscovery discovery;
    private Uploader uploader;

    private final TextWatcher refreshWatcher = new TextWatcher() {
        @Override
        public void beforeTextChanged(CharSequence s, int start, int count, int after) {
        }

        @Override
        public void onTextChanged(CharSequence s, int start, int before, int count) {
        }

        @Override
        public void afterTextChanged(Editable s) {
            refreshUploadButton();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        setupWindow();
        setContentView(buildUi());
        loadSavedAddress();
        restoreSavedTree();
    }

    private void setupWindow() {
        Window window = getWindow();
        window.setStatusBarColor(C_BG);
        window.setNavigationBarColor(C_BG);
        window.setBackgroundDrawable(new ColorDrawable(C_BG));
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    // =====================================================================
    // UI 构建
    // =====================================================================

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(C_BG);
        scroll.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(18);
        root.setPadding(pad, dp(22), pad, dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(MATCH, WRAP));

        TextView title = new TextView(this);
        title.setText("Samsung Health 直传");
        title.setTextColor(C_TEXT);
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("选导出目录 → 多线程打包 ZIP → 同一 Wi-Fi 直传电脑（先压缩后传输）");
        subtitle.setTextColor(C_TEXT_DIM);
        subtitle.setTextSize(13);
        subtitle.setLineSpacing(dp(3), 1f);
        addTo(root, subtitle, dp(6));

        buildConnectionCard(root);
        buildDirectoryCard(root);
        buildUploadCard(root);
        buildStatusCard(root);
        return scroll;
    }

    private void buildConnectionCard(LinearLayout root) {
        LinearLayout card = card();
        card.addView(sectionTitle("① 连接电脑"));

        connState = bodyText("未连接。可点「搜索电脑」自动发现，或手动填写 IP / 端口。", C_TEXT_DIM);
        addTo(card, connState, 0);

        ipField = inputField("电脑 IP，例如 192.168.1.10",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 64);
        portField = inputField("端口", InputType.TYPE_CLASS_NUMBER, 5);
        tokenField = inputField("电脑端显示的 6 位令牌", InputType.TYPE_CLASS_NUMBER, 6);

        addTo(card, labeledRow("电脑 IP", ipField), dp(12));
        addTo(card, labeledRow("端口", portField), dp(8));
        addTo(card, labeledRow("令牌", tokenField), dp(8));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        scanButton = actionButton("搜索电脑", false);
        scanButton.setOnClickListener(v -> startScan());
        testButton = actionButton("测试连接", false);
        testButton.setOnClickListener(v -> testConnection());
        buttons.addView(scanButton, weighted(1f, 0));
        buttons.addView(testButton, weighted(1f, dp(10)));
        addTo(card, buttons, dp(12));

        root.addView(card);
    }

    private void buildDirectoryCard(LinearLayout root) {
        LinearLayout card = card();
        card.addView(sectionTitle("② 选择导出目录"));
        card.addView(bodyText(
                "选择三星健康导出的目录。若选的是包含 samsunghealth_* 子目录的父目录，会自动进入该导出目录。",
                C_TEXT_DIM));

        pickButton = actionButton("选择目录", false);
        pickButton.setOnClickListener(v -> pickDirectory());
        addTo(card, pickButton, dp(12));

        dirInfo = bodyText("尚未选择目录", C_TEXT);
        addTo(card, dirInfo, dp(10));

        root.addView(card);
    }

    private void buildUploadCard(LinearLayout root) {
        LinearLayout card = card();
        card.addView(sectionTitle("③ 上传到电脑"));

        addTo(card, bodyText(
                "打包默认使用 deflate 压缩（省流量）。同一 Wi-Fi 下网络很快时，可以关闭压缩：打包更快，"
                        + "但 ZIP 体积会接近导出目录的原始大小。",
                C_TEXT_DIM), 0);

        compressCheck = new CheckBox(this);
        compressCheck.setText("压缩 ZIP（关闭后打包更快、包更大）");
        compressCheck.setTextColor(C_TEXT);
        compressCheck.setTextSize(13);
        compressCheck.setButtonTintList(ColorStateList.valueOf(C_ACCENT));
        compressCheck.setChecked(prefs.getBoolean(PREF_COMPRESS, true));
        compressCheck.setOnCheckedChangeListener((buttonView, isChecked) -> {
            prefs.edit().putBoolean(PREF_COMPRESS, isChecked).apply();
            // 压缩策略变了，旧的临时 ZIP 不能复用
            if (packed != null) {
                deletePacked();
                uploadButton.setText("开始上传");
            }
        });
        addTo(card, compressCheck, dp(10));

        uploadButton = actionButton("开始上传", true);
        uploadButton.setEnabled(false);
        uploadButton.setOnClickListener(v -> startUpload());
        addTo(card, uploadButton, 0);

        progressGroup = new LinearLayout(this);
        progressGroup.setOrientation(LinearLayout.VERTICAL);
        progressGroup.setVisibility(View.GONE);

        progressText = bodyText("", C_TEXT);
        progressGroup.addView(progressText);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(1000);
        progressBar.setProgress(0);
        progressBar.setProgressTintList(ColorStateList.valueOf(C_ACCENT));
        progressBar.setProgressBackgroundTintList(ColorStateList.valueOf(C_STROKE));
        LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(MATCH, dp(6));
        barParams.topMargin = dp(10);
        progressBar.setLayoutParams(barParams);
        progressGroup.addView(progressBar);

        cancelButton = actionButton("取消上传", false);
        cancelButton.setVisibility(View.GONE);
        cancelButton.setOnClickListener(v -> cancelUpload());
        addTo(progressGroup, cancelButton, dp(12));

        addTo(card, progressGroup, dp(14));
        root.addView(card);
    }

    private void buildStatusCard(LinearLayout root) {
        LinearLayout card = card();
        card.addView(sectionTitle("状态"));
        statusText = bodyText(
                "提示：电脑端需与手机在同一 Wi-Fi；首次连接时请在电脑防火墙中放行 TCP 8737 与 UDP 8738。",
                C_TEXT_DIM);
        card.addView(statusText);
        root.addView(card);
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(roundRect(C_SURFACE, dp(16), C_STROKE, dp(1)));
        int padding = dp(16);
        card.setPadding(padding, padding, padding, padding);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(MATCH, WRAP);
        params.topMargin = dp(14);
        card.setLayoutParams(params);
        return card;
    }

    private TextView sectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(C_ACCENT);
        view.setTextSize(13);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setLetterSpacing(0.04f);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(MATCH, WRAP);
        params.bottomMargin = dp(10);
        view.setLayoutParams(params);
        return view;
    }

    private TextView bodyText(String text, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(13);
        view.setLineSpacing(dp(3), 1f);
        return view;
    }

    private EditText inputField(String hint, int inputType, int maxLength) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setHintTextColor(C_TEXT_DIM);
        field.setTextColor(C_TEXT);
        field.setTextSize(15);
        field.setSingleLine(true);
        field.setInputType(inputType);
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(maxLength)});
        field.setBackground(roundRect(C_FIELD, dp(10), C_STROKE, dp(1)));
        field.setPadding(dp(12), dp(10), dp(12), dp(10));
        field.setMinHeight(dp(46));
        field.addTextChangedListener(refreshWatcher);
        return field;
    }

    private LinearLayout labeledRow(String label, EditText field) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextColor(C_TEXT_DIM);
        labelView.setTextSize(13);
        labelView.setWidth(dp(62));
        row.addView(labelView);

        row.addView(field, new LinearLayout.LayoutParams(0, WRAP, 1f));
        return row;
    }

    private Button actionButton(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        int fill = primary ? C_ACCENT : C_FIELD;
        int textColor = primary ? C_ON_ACCENT : C_TEXT;
        button.setTextColor(new ColorStateList(
                new int[][]{
                        new int[]{android.R.attr.state_enabled},
                        new int[]{-android.R.attr.state_enabled},
                },
                new int[]{textColor, C_TEXT_DIM}));
        GradientDrawable background = roundRect(fill, dp(12), primary ? 0 : C_STROKE, dp(1));
        button.setBackground(new RippleDrawable(
                ColorStateList.valueOf(0x33FFFFFF), background, null));
        button.setMinHeight(dp(46));
        button.setMinimumHeight(dp(46));
        button.setPadding(dp(12), dp(10), dp(12), dp(10));
        button.setStateListAnimator(null);
        button.setElevation(0f);
        return button;
    }

    private GradientDrawable roundRect(int fill, float radius, int strokeColor, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) {
            drawable.setStroke(strokeWidth, strokeColor);
        }
        return drawable;
    }

    private void addTo(LinearLayout parent, View child, int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(MATCH, WRAP);
        params.topMargin = topMargin;
        parent.addView(child, params);
    }

    private LinearLayout.LayoutParams weighted(float weight, int startMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, WRAP, weight);
        params.leftMargin = startMargin;
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    // =====================================================================
    // 地址 / 目录状态
    // =====================================================================

    private void loadSavedAddress() {
        String ip = prefs.getString(PREF_IP, "");
        int port = prefs.getInt(PREF_PORT, DEFAULT_PORT);
        if (ip != null && !ip.isEmpty()) {
            ipField.setText(ip);
        }
        portField.setText(String.valueOf(port));
    }

    private void saveAddress(String ip, int port) {
        prefs.edit().putString(PREF_IP, ip).putInt(PREF_PORT, port).apply();
    }

    private void restoreSavedTree() {
        String saved = prefs.getString(PREF_TREE, null);
        if (saved == null || saved.isEmpty()) {
            return;
        }
        Uri uri;
        try {
            uri = Uri.parse(saved);
        } catch (RuntimeException e) {
            prefs.edit().remove(PREF_TREE).apply();
            return;
        }
        boolean granted = false;
        try {
            List<UriPermission> permissions = getContentResolver().getPersistedUriPermissions();
            for (UriPermission permission : permissions) {
                if (permission.isReadPermission() && permission.getUri().equals(uri)) {
                    granted = true;
                    break;
                }
            }
        } catch (RuntimeException ignored) {
            // 忽略：按未授权处理
        }
        if (!granted) {
            prefs.edit().remove(PREF_TREE).apply();
            return;
        }
        analyzeTree(uri);
    }

    private String validIp() {
        String value = ipField.getText().toString().trim();
        if (value.isEmpty() || value.length() > 64) {
            return null;
        }
        if (value.contains(" ") || value.contains("/") || value.contains("\\")) {
            return null;
        }
        return value;
    }

    private int validPort() {
        try {
            int port = Integer.parseInt(portField.getText().toString().trim());
            return (port > 0 && port <= 65535) ? port : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private String validToken() {
        String value = tokenField.getText().toString().trim();
        return value.matches("\\d{6}") ? value : null;
    }

    private void refreshUploadButton() {
        if (uploadButton == null || uploading || analyzing) {
            return;
        }
        boolean ready = tree != null && !packing && validIp() != null
                && validPort() > 0 && validToken() != null;
        uploadButton.setEnabled(ready);
    }

    private void setControlsEnabled(boolean enabled) {
        ipField.setEnabled(enabled);
        portField.setEnabled(enabled);
        tokenField.setEnabled(enabled);
        scanButton.setEnabled(enabled);
        testButton.setEnabled(enabled);
        pickButton.setEnabled(enabled);
        if (compressCheck != null) {
            compressCheck.setEnabled(enabled);
        }
        if (enabled) {
            refreshUploadButton();
        } else {
            uploadButton.setEnabled(false);
        }
    }

    // =====================================================================
    // 自动发现 & 连接测试
    // =====================================================================

    private void startScan() {
        if (discovery != null) {
            return;
        }
        setStatus("正在搜索同一 Wi-Fi 内的电脑，最多等待 12 秒…", StatusKind.NORMAL);
        setConnState("正在监听电脑广播…", C_TEXT_DIM);
        scanButton.setEnabled(false);
        scanButton.setText("搜索中…");

        final LanDiscovery scanner = new LanDiscovery();
        discovery = scanner;
        scanner.start(SCAN_TIMEOUT_MS, new LanDiscovery.Listener() {
            @Override
            public void onFound(String ip, int httpPort, String hostName) {
                post(() -> {
                    ipField.setText(ip);
                    portField.setText(String.valueOf(httpPort));
                    saveAddress(ip, httpPort);
                    String suffix = (hostName == null || hostName.isEmpty()) ? "" : "（" + hostName + "）";
                    setConnState("已发现电脑" + suffix + "，正在验证连接…", C_ACCENT);
                    testConnection();
                });
            }

            @Override
            public void onFinished(boolean found, String message) {
                post(() -> {
                    if (discovery == scanner) {
                        discovery = null;
                    }
                    scanButton.setText("搜索电脑");
                    scanButton.setEnabled(!uploading);
                    if (!found) {
                        setConnState("未发现电脑，请手动输入 IP 和端口", C_WARN);
                        setStatus(message, StatusKind.WARN);
                    }
                });
            }
        });
    }

    private void testConnection() {
        final String ip = validIp();
        final int port = validPort();
        if (ip == null) {
            setStatus("请填写电脑的 IP 地址（可在电脑端接收器界面找到）。", StatusKind.ERROR);
            return;
        }
        if (port < 0) {
            setStatus("端口需为 1–65535 之间的数字（默认 8737）。", StatusKind.ERROR);
            return;
        }
        saveAddress(ip, port);
        testButton.setEnabled(false);
        testButton.setText("连接中…");
        setConnState("正在连接 " + ip + ":" + port + " …", C_TEXT_DIM);

        background.execute(() -> {
            final String error = Uploader.checkHealth(ip, port);
            post(() -> {
                testButton.setText("测试连接");
                testButton.setEnabled(!uploading);
                if (error == null) {
                    setConnState("已连接电脑 " + ip + ":" + port, C_ACCENT);
                    setStatus("已连接电脑，可以开始上传。", StatusKind.OK);
                } else {
                    setConnState(error, C_ERROR);
                    setStatus(error, StatusKind.ERROR);
                }
            });
        });
    }

    private void setConnState(String message, int color) {
        connState.setText(message);
        connState.setTextColor(color);
    }

    // =====================================================================
    // 选择目录 / 统计
    // =====================================================================

    private void pickDirectory() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQUEST_PICK_DIR);
        } catch (ActivityNotFoundException e) {
            setStatus("系统没有可用的目录选择器，无法选择导出目录。", StatusKind.ERROR);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PICK_DIR || resultCode != RESULT_OK || data == null) {
            return;
        }
        Uri uri = data.getData();
        if (uri == null) {
            return;
        }
        if (tree != null && !tree.treeUri.equals(uri)) {
            releaseTreePermission(tree.treeUri);
        }
        try {
            getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (RuntimeException e) {
            setStatus("已选择目录，但系统未授予长期访问权限，下次打开 App 时需要重新选择。",
                    StatusKind.WARN);
        }
        analyzeTree(uri);
    }

    private void releaseTreePermission(Uri uri) {
        try {
            getContentResolver().releasePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // 忽略
        }
    }

    private void analyzeTree(Uri uri) {
        analyzing = true;
        tree = null;
        packing = false;
        deletePacked();
        dirInfo.setText("正在读取目录…");
        refreshUploadButton();

        final ContentResolver resolver = getContentResolver();
        background.execute(() -> {
            ExportTree resolved = null;
            String error = null;
            try {
                // 只解析目录（一次 query），不做全量文件统计：2 万+ 文件的遍历会明显拖慢「开始上传」
                resolved = ExportTree.resolve(resolver, uri);
            } catch (ExportTree.TreeException e) {
                error = e.getMessage();
            } catch (IOException e) {
                error = "读取目录失败，请重新选择三星健康的导出目录。";
            } catch (RuntimeException e) {
                error = "读取目录失败，请重新选择三星健康的导出目录。";
            }

            final ExportTree finalTree = resolved;
            final String finalError = error;
            post(() -> {
                analyzing = false;
                if (finalTree == null) {
                    tree = null;
                    dirInfo.setText("读取目录失败，请重新选择");
                    setStatus(finalError == null ? "读取目录失败，请重新选择。" : finalError,
                            StatusKind.ERROR);
                    prefs.edit().remove(PREF_TREE).apply();
                } else {
                    onTreeReady(uri, finalTree);
                }
                refreshUploadButton();
            });
        });
    }

    private void onTreeReady(Uri uri, ExportTree resolved) {
        tree = resolved;
        deletePacked();
        prefs.edit().putString(PREF_TREE, uri.toString()).apply();

        StringBuilder builder = new StringBuilder();
        builder.append("已选择：").append(resolved.rootName);
        if (resolved.autoDrilled) {
            builder.append("\n已自动进入导出子目录");
        }
        builder.append("\n点「开始上传」后先在手机上并行打包，再整包发送到电脑。");
        dirInfo.setText(builder.toString());
        setStatus("目录已就绪：开始上传时先多线程压缩，完成后再发送。", StatusKind.OK);
    }

    // =====================================================================
    // 上传
    // =====================================================================

    private void startUpload() {
        if (uploading || packing || analyzing) {
            return;
        }
        String ip = validIp();
        if (ip == null) {
            setStatus("请填写电脑的 IP 地址（可在电脑端接收器界面找到）。", StatusKind.ERROR);
            return;
        }
        int port = validPort();
        if (port < 0) {
            setStatus("端口需为 1–65535 之间的数字（默认 8737）。", StatusKind.ERROR);
            return;
        }
        String token = validToken();
        if (token == null) {
            setStatus("请填写电脑端显示的 6 位数字令牌。", StatusKind.ERROR);
            return;
        }
        if (tree == null) {
            setStatus("请先选择三星健康的导出目录。", StatusKind.ERROR);
            return;
        }
        saveAddress(ip, port);
        hideKeyboard();
        if (packed != null) {
            // 上次打包完成但上传失败/取消：直接复用临时 ZIP 重试，不重新压缩
            beginUpload(ip, port, token);
        } else {
            startPacking(ip, port, token);
        }
    }

    /** 第一阶段：多线程打包到临时 ZIP（不阻塞，回调切回主线程）。 */
    private void startPacking(String ip, int port, String token) {
        cancelRequested = false;
        packing = true;
        setControlsEnabled(false);
        uploadButton.setText("打包中…");
        progressGroup.setVisibility(View.VISIBLE);
        progressBar.setIndeterminate(true);
        progressBar.setProgress(0);
        progressText.setText("准备打包…");
        cancelButton.setVisibility(View.VISIBLE);
        cancelButton.setEnabled(true);
        cancelButton.setText("取消");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setStatus("正在多线程打包，完成后会自动开始上传；请保持 App 在前台。", StatusKind.NORMAL);

        final String host = ip;
        final int httpPort = port;
        final String uploadToken = token;
        File temp = new File(getCacheDir(), "upload-" + System.currentTimeMillis() + ".zip");
        final boolean compress = compressCheck == null || compressCheck.isChecked();
        packer = new ZipPacker(getContentResolver(), tree, temp,
                Runtime.getRuntime().availableProcessors(), compress, new ZipPacker.Listener() {
            @Override
            public void onProgress(long files, long sourceBytes, long zipBytes) {
                post(() -> {
                    if (packing) {
                        progressText.setText("打包中 · " + files + " 个文件 · 已读 "
                                + formatBytes(sourceBytes) + " → ZIP " + formatBytes(zipBytes));
                    }
                });
            }

            @Override
            public void onDone(ZipPacker.Result result) {
                post(() -> {
                    packer = null;
                    packing = false;
                    packed = result;
                    if (cancelRequested) {
                        deletePacked();
                        finishPacking();
                        progressText.setText("已取消打包");
                        return;
                    }
                    beginUpload(host, httpPort, uploadToken);
                });
            }

            @Override
            public void onError(String message) {
                post(() -> {
                    packer = null;
                    packing = false;
                    finishPacking();
                    progressText.setText("打包失败");
                    setStatus(message, StatusKind.ERROR);
                });
            }

            @Override
            public void onCancelled() {
                post(() -> {
                    packer = null;
                    packing = false;
                    finishPacking();
                    progressText.setText("已取消打包");
                    setStatus("已取消打包，没有上传。", StatusKind.WARN);
                });
            }
        });
        packer.start();
    }

    /** 第二阶段：把临时 ZIP 整包上传（固定长度 + SHA-256）。 */
    private void beginUpload(String ip, int port, String token) {
        if (packed == null || tree == null) {
            finishPacking();
            return;
        }
        cancelRequested = false;
        uploadStartedAt = System.currentTimeMillis();
        packing = false;
        uploading = true;
        setControlsEnabled(false);
        uploadButton.setText("上传中…");
        progressGroup.setVisibility(View.VISIBLE);
        progressBar.setIndeterminate(false);
        progressBar.setProgress(0);
        progressText.setText("准备发送…");
        cancelButton.setVisibility(View.VISIBLE);
        cancelButton.setEnabled(true);
        cancelButton.setText("取消上传");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setStatus("正在发送已打包的 ZIP（" + formatBytes(packed.zipBytes) + "），请保持 App 在前台。",
                StatusKind.NORMAL);

        final ZipPacker.Result result = packed;
        final String fileName = Uploader.buildFileName(tree.rootName);
        uploader = new Uploader(result.file, result.sha256, fileName, ip, port, token,
                new Uploader.Listener() {
                    @Override
                    public void onProgress(long sentBytes, long totalBytes, long bytesPerSecond) {
                        if (destroyed) {
                            return;
                        }
                        updateProgress(sentBytes, totalBytes, bytesPerSecond);
                    }

                    @Override
                    public void onSuccess(String name, long bytes) {
                        if (destroyed) {
                            return;
                        }
                        long uploadMs = Math.max(1L, System.currentTimeMillis() - uploadStartedAt);
                        String ratio = result.sourceBytes > 0 && result.zipBytes > 0
                                ? String.format(Locale.US, "，压缩率 %.1fx",
                                (double) result.sourceBytes / result.zipBytes)
                                : "";
                        String summary = "上传成功：" + name + "（ZIP " + formatBytes(bytes)
                                + ratio + "，打包 " + formatMs(result.elapsedMs) + "，上传 "
                                + formatMs(uploadMs) + "，平均 "
                                + formatSpeed(bytes * 1000L / uploadMs) + "）";
                        deletePacked();
                        finishUploading();
                        progressBar.setIndeterminate(false);
                        progressBar.setProgress(1000);
                        progressText.setText("上传完成 · " + formatBytes(bytes));
                        setStatus(summary + "。电脑端正在解析，稍后可在电脑端查看。", StatusKind.OK);
                    }

                    @Override
                    public void onFailure(String message) {
                        if (destroyed) {
                            return;
                        }
                        finishUploading();
                        progressBar.setIndeterminate(false);
                        progressBar.setProgress(0);
                        progressText.setText("上传失败（已保留打包文件，可直接重试）");
                        uploadButton.setText("重试上传");
                        setStatus(message, StatusKind.ERROR);
                    }

                    @Override
                    public void onCancelled() {
                        if (destroyed) {
                            return;
                        }
                        finishUploading();
                        progressBar.setIndeterminate(false);
                        progressBar.setProgress(0);
                        progressText.setText("已取消上传（已保留打包文件，可直接重试）");
                        uploadButton.setText("重试上传");
                        setStatus("已取消上传，文件没有完整发送。", StatusKind.WARN);
                    }
                });
        uploader.start();
    }

    private void finishPacking() {
        packing = false;
        packer = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setControlsEnabled(true);
        uploadButton.setText("开始上传");
        cancelButton.setVisibility(View.GONE);
        cancelButton.setEnabled(true);
        cancelButton.setText("取消");
    }

    private void deletePacked() {
        if (packed != null && packed.file != null) {
            //noinspection ResultOfMethodCallIgnored
            packed.file.delete();
        }
        packed = null;
    }

    private void cancelUpload() {
        cancelRequested = true;
        cancelButton.setEnabled(false);
        cancelButton.setText("取消中…");
        if (packing && packer != null) {
            packer.cancel();
            return;
        }
        if (uploader != null) {
            uploader.cancel();
            return;
        }
        if (packing) {
            // 打包线程尚未就绪或已结束
            finishPacking();
        }
    }

    private void updateProgress(long sent, long total, long bytesPerSecond) {
        if (total <= 0) {
            progressBar.setIndeterminate(true);
            progressText.setText("已发送 " + formatBytes(sent) + " · " + formatSpeed(bytesPerSecond));
            return;
        }
        int barValue = (int) Math.min(999L, sent * 1000L / total);
        progressBar.setIndeterminate(false);
        progressBar.setProgress(barValue);
        double percent = Math.min(99.9, sent * 100.0 / total);
        progressText.setText(String.format(Locale.US, "%.1f%%", percent)
                + " · " + formatBytes(sent) + " / " + formatBytes(total)
                + " · " + formatSpeed(bytesPerSecond));
    }

    private void finishUploading() {
        uploading = false;
        uploader = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setControlsEnabled(true);
        uploadButton.setText("开始上传");
        cancelButton.setVisibility(View.GONE);
        cancelButton.setEnabled(true);
        cancelButton.setText("取消上传");
    }

    private void hideKeyboard() {
        View focus = getCurrentFocus();
        if (focus == null) {
            return;
        }
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) {
            manager.hideSoftInputFromWindow(focus.getWindowToken(), 0);
        }
        focus.clearFocus();
    }

    // =====================================================================
    // 状态 / 格式化
    // =====================================================================

    private void setStatus(String message, StatusKind kind) {
        if (statusText == null) {
            return;
        }
        int color;
        switch (kind) {
            case OK:
                color = C_ACCENT;
                break;
            case WARN:
                color = C_WARN;
                break;
            case ERROR:
                color = C_ERROR;
                break;
            default:
                color = C_TEXT_DIM;
                break;
        }
        statusText.setText(message);
        statusText.setTextColor(color);
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024L) {
            return bytes + " B";
        }
        double kb = bytes / 1024.0;
        if (kb < 1024.0) {
            return String.format(Locale.US, "%.1f KB", kb);
        }
        double mb = kb / 1024.0;
        if (mb < 1024.0) {
            return String.format(Locale.US, "%.1f MB", mb);
        }
        return String.format(Locale.US, "%.2f GB", mb / 1024.0);
    }

    private String formatSpeed(long bytesPerSecond) {
        if (bytesPerSecond <= 0L) {
            return "—";
        }
        return formatBytes(bytesPerSecond) + "/s";
    }

    private String formatMs(long ms) {
        if (ms < 1000L) {
            return ms + " ms";
        }
        return String.format(Locale.US, "%.1f s", ms / 1000.0);
    }

    private void post(Runnable runnable) {
        ui.post(() -> {
            if (!destroyed) {
                runnable.run();
            }
        });
    }

    // =====================================================================
    // 生命周期
    // =====================================================================

    @Override
    protected void onPause() {
        super.onPause();
        String ip = validIp();
        int port = validPort();
        if (ip != null && port > 0) {
            saveAddress(ip, port);
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (discovery != null) {
            discovery.stop();
            discovery = null;
        }
        if (uploader != null) {
            uploader.cancel();
            uploader = null;
        }
        if (packer != null) {
            packer.cancel();
            packer = null;
        }
        deletePacked();
        background.shutdownNow();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (uploading || packing) {
            new AlertDialog.Builder(this)
                    .setMessage(uploading ? "正在上传，确定要取消并退出吗？" : "正在打包，确定要取消并退出吗？")
                    .setNegativeButton("继续", null)
                    .setPositiveButton("取消并退出", (dialog, which) -> {
                        if (uploader != null) {
                            uploader.cancel();
                        }
                        if (packer != null) {
                            packer.cancel();
                        }
                        deletePacked();
                        finish();
                    })
                    .show();
            return;
        }
        super.onBackPressed();
    }
}
