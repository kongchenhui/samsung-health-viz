<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  store,
  lan,
  pickZip,
  pickFolder,
  showToast,
  refreshLanStatus,
  lanEnable,
  lanDisable,
  lanRegenerateToken,
  lanClearFiles,
  lanCopy,
  openStadiaKeyDialog,
  clearStadiaKey,
  setThemeMode,
  setAppLocale,
  setMapStyleAuto,
  styleHasPair,
} from '../store.js';
import { km, durationText } from '../lib/format.js';
import { LOCALE_CODES, localeName, t } from '../lib/i18n.js';

/* ---- 侧边栏：分组导航（布局参考系统设置：左侧导航 + 右侧内容） ---- */
const navGroups = [
  {
    key: 'app',
    label: 'settings.groupApp',
    items: [
      { key: 'general', label: 'settings.navGeneral' },
      { key: 'map', label: 'settings.navMap' },
      { key: 'data', label: 'settings.navData' },
    ],
  },
  {
    key: 'about',
    label: 'settings.groupAbout',
    items: [{ key: 'about', label: 'settings.about' }],
  },
];
const TAB_KEYS = navGroups.flatMap((g) => g.items.map((i) => i.key));

/* 分栏由地址栏 ?tab= 驱动：欢迎页、深链、IPC 都能直接落到指定分栏 */
const route = useRoute();
const router = useRouter();
const tab = computed(() => {
  const value = route.query.tab;
  return typeof value === 'string' && TAB_KEYS.includes(value) ? value : 'general';
});
function selectTab(key) {
  if (key === tab.value) return;
  const query = { ...route.query };
  if (key === 'general') delete query.tab;
  else query.tab = key;
  router.replace({ query });
}
// 地址栏带了不认识的 tab 时清掉，保持 URL 与当前分栏一致
watch(
  () => route.query.tab,
  (value) => {
    if (route.name !== 'settings') return;
    if (typeof value === 'string' && !TAB_KEYS.includes(value)) {
      const query = { ...route.query };
      delete query.tab;
      router.replace({ query });
    }
  },
);

const themeModes = ['system', 'dark', 'light'];
const styleName = computed(() => t('mapStyle.' + store.mapStyle));
const version = computed(() => store.info?.appVersion || '');
const buildInfo = computed(() => {
  const v = store.info?.versions || {};
  return t('settings.buildInfo', { electron: v.electron || '—', chrome: v.chrome || '—' });
});

// 检查更新：开发模式由主进程弹说明，正式包走 electron-updater（结果也在主进程弹窗）
const checkingUpdates = ref(false);
async function checkUpdates() {
  if (checkingUpdates.value) return;
  checkingUpdates.value = true;
  try {
    await window.api.checkUpdates();
  } finally {
    setTimeout(() => (checkingUpdates.value = false), 1200);
  }
}

function openReleasePage() {
  const url = store.info?.releasePage;
  if (url) window.api.openExternal(url);
}

const meta = computed(() => store.dataset?.meta || {});

function maskPhone(phone) {
  if (!phone) return '—';
  return phone.length > 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}
const warnings = computed(() => meta.value.warnings || []);
const cachePath = computed(() => store.info?.cachePath || '');

function reveal(path) {
  if (path) window.api.reveal(path);
}

async function clearCache() {
  await window.api.clear();
  store.dataset = null;
  showToast(t('toast.cacheCleared'));
}

/* ---- 手机直传 ---- */
const lanPrimaryUrl = computed(() => lan.urls[0] || '');
const lanStateText = computed(() => {
  if (!lan.running) return t('data.lan.stateOff');
  if (lan.phase === 'receiving') return t('data.lan.stateReceiving');
  if (lan.phase === 'parsing') return t('data.lan.stateParsing');
  if (lan.phase === 'done') return t('data.lan.stateDone');
  if (lan.phase === 'error') return t('data.lan.stateError', { error: lan.error || t('toast.receiveError') });
  return t('data.lan.stateWaiting');
});

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function receiveDetail(upload) {
  if (!upload) return '';
  const parts = [];
  if (upload.bytes && upload.receiveMs) {
    const speed = (upload.bytes / (upload.receiveMs / 1000) / (1024 * 1024)).toFixed(1);
    parts.push(`${t('data.lan.receivedMs', { time: fmtDuration(upload.receiveMs) })} · ${speed} MB/s`);
  }
  if (upload.parseMs) parts.push(t('data.lan.parsedMs', { time: fmtDuration(upload.parseMs) }));
  return parts.join(' · ');
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** 「已导入 xxx（12.3 MB · 接收 1.2 s）」 */
function importedText(upload) {
  const pieces = [fmtBytes(upload.bytes)];
  const detail = receiveDetail(upload);
  if (detail) pieces.push(detail);
  return t('data.lan.imported', {
    name: upload.name || t('data.lan.uploadedPackage'),
    detail: pieces.join(' · '),
  });
}

const lanSpeedText = computed(() => {
  if (lan.phase !== 'receiving' || !lan.startedAt || !lan.receivedBytes) return '';
  const secs = Math.max(1, (Date.now() - lan.startedAt) / 1000);
  const mbs = lan.receivedBytes / secs / (1024 * 1024);
  return `${mbs.toFixed(1)} MB/s`;
});

function revealUploads() {
  window.api.lanReveal();
}

/* ---- Stadia 底图 Key ---- */
function openStadiaConsole() {
  window.api.openExternal('https://client.stadiamaps.com/dashboard/');
}

onMounted(() => refreshLanStatus());
</script>

<template>
  <div class="settings-shell">
    <!-- 左侧导航 -->
    <aside class="settings-sidebar">
      <div class="settings-side-title">{{ t('settings.title') }}</div>
      <nav class="settings-nav">
        <div v-for="group in navGroups" :key="group.key" class="settings-group">
          <span class="settings-group-title">{{ t(group.label) }}</span>
          <button
            v-for="item in group.items"
            :key="item.key"
            class="settings-nav-item"
            :class="{ active: tab === item.key }"
            :aria-current="tab === item.key ? 'page' : undefined"
            @click="selectTab(item.key)"
          >
            <span class="settings-nav-icon" aria-hidden="true">
              <svg v-if="item.key === 'general'" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M3 6h9M16 6h1M3 14h1M8 14h9" />
                <circle cx="13.5" cy="6" r="2.2" />
                <circle cx="5.5" cy="14" r="2.2" />
              </svg>
              <svg v-else-if="item.key === 'map'" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z" />
                <path d="M7.5 3.5v11M12.5 5.5v11" />
              </svg>
              <svg v-else-if="item.key === 'data'" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="10" cy="5" rx="6" ry="2.4" />
                <path d="M4 5v10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5" />
                <path d="M4 10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4" />
              </svg>
              <svg v-else viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="10" cy="10" r="7" />
                <path d="M10 9v4.5M10 6.6v.2" />
              </svg>
            </span>
            {{ t(item.label) }}
          </button>
        </div>
      </nav>
      <div class="settings-side-foot">
        <span v-if="version">v{{ version }}</span>
      </div>
    </aside>

    <!-- 右侧内容 -->
    <section class="settings-content">
      <!-- 通用：主题 / 语言 / 底图跟随主题 -->
      <template v-if="tab === 'general'">
        <div class="settings-page-head">
          <div>
            <h2 class="settings-page-title">{{ t('settings.navGeneral') }}</h2>
            <p class="settings-page-sub">{{ t('settings.generalSubtitle') }}</p>
          </div>
        </div>

        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.theme') }}</span>
            <div class="segmented">
              <button
                v-for="m in themeModes"
                :key="m"
                class="chip"
                :class="{ active: store.themeMode === m }"
                :aria-pressed="store.themeMode === m"
                @click="setThemeMode(m)"
              >
                {{ t('settings.mode.' + m) }}
              </button>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.language') }}</span>
            <div class="segmented">
              <button
                v-for="code in LOCALE_CODES"
                :key="code"
                class="chip"
                :class="{ active: store.locale === code }"
                :aria-pressed="store.locale === code"
                @click="setAppLocale(code)"
              >
                {{ localeName(code) }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 地图：底图行为与 Stadia API Key（Key 属于地图配置，不放在数据页） -->
      <template v-else-if="tab === 'map'">
        <div class="settings-page-head">
          <div>
            <h2 class="settings-page-title">{{ t('settings.navMap') }}</h2>
            <p class="settings-page-sub">{{ t('settings.mapSubtitle') }}</p>
          </div>
        </div>

        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.followTheme') }}</span>
            <label class="settings-switch">
              <input type="checkbox" :checked="store.mapStyleAuto" @change="setMapStyleAuto($event.target.checked)" />
              <span>{{ store.mapStyleAuto ? t('settings.on') : t('settings.off') }}</span>
            </label>
          </div>
          <p class="settings-hint">{{ t('settings.followThemeDesc') }}</p>
          <p v-if="!styleHasPair(store.mapStyle)" class="settings-hint warn">
            {{ t('settings.followThemeNoPair', { style: styleName }) }}
          </p>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>{{ t('data.stadia.title') }}</h3>
            <span class="badge" :class="store.stadiaKey ? 'ok' : 'off'">
              {{ store.stadiaKey ? t('data.stadia.keySet') : t('data.stadia.noKey') }}
            </span>
          </div>
          <p class="lan-desc">{{ t('data.stadia.desc') }}</p>
          <div class="lan-actions">
            <button class="btn primary" @click="openStadiaKeyDialog()">
              {{ store.stadiaKey ? t('data.stadia.changeKey') : t('data.stadia.enterKey') }}
            </button>
            <button class="btn ghost" @click="openStadiaConsole">{{ t('data.stadia.getKey') }}</button>
            <button v-if="store.stadiaKey" class="btn ghost" @click="clearStadiaKey">
              {{ t('data.stadia.clearKey') }}
            </button>
          </div>
          <p class="lan-hint">{{ t('data.stadia.hint') }}</p>
        </div>

      </template>

      <!-- 数据：导入与手机直传 -->
      <template v-else-if="tab === 'data'">
        <div class="settings-page-head">
          <div>
            <h2 class="settings-page-title">{{ t('settings.navData') }}</h2>
            <p class="settings-page-sub">{{ t('settings.dataSubtitle') }}</p>
          </div>
          <div class="settings-page-actions">
            <button class="btn primary small" @click="pickZip()">{{ t('data.pickZip') }}</button>
            <button class="btn ghost small" @click="pickFolder()">{{ t('data.pickFolder') }}</button>
          </div>
        </div>

        <div class="card lan-card">
          <div class="card-head">
            <h3>{{ t('data.lan.title') }}</h3>
            <span class="badge" :class="lan.running ? 'ok' : 'off'">
              {{ lan.running ? t('data.lan.receiving', { port: lan.port }) : t('data.lan.off') }}
            </span>
          </div>
          <p class="lan-desc">{{ t('data.lan.desc') }}</p>

          <div v-if="!lan.running" class="lan-off">
            <button class="btn primary" :disabled="lan.starting" @click="lanEnable">
              {{ lan.starting ? t('data.lan.starting') : t('data.lan.start') }}
            </button>
            <span class="lan-hint">{{ t('data.lan.firewallHint') }}</span>
            <span v-if="lan.error" class="lan-error">{{ lan.error }}</span>
          </div>

          <div v-else class="lan-on">
            <div class="info-grid lan-grid">
              <div class="info-item">
                <span>{{ t('data.lan.address') }}</span>
                <b class="mono">{{ lanPrimaryUrl || '—' }}</b>
              </div>
              <div class="info-item">
                <span>{{ t('data.lan.token') }}</span>
                <b class="mono lan-token">{{ lan.token }}</b>
              </div>
              <div class="info-item">
                <span>{{ t('data.lan.status') }}</span>
                <b>{{ lanStateText }}</b>
              </div>
            </div>

            <div v-if="lan.phase === 'receiving' || lan.phase === 'parsing'" class="lan-progress">
              <div class="lan-progress-head">
                <span>{{ lan.uploadName || t('data.lan.uploading') }}</span>
                <span class="muted">
                  {{
                    lan.phase === 'parsing'
                      ? t('data.lan.parsing')
                      : t('data.lan.received', { bytes: fmtBytes(lan.receivedBytes) }) +
                        (lanSpeedText ? ' · ' + lanSpeedText : '')
                  }}
                </span>
              </div>
              <div class="lan-bar"><i :class="{ parsing: lan.phase === 'parsing' }"></i></div>
            </div>

            <div v-if="lan.phase === 'done' && lan.lastUpload" class="lan-result ok">
              {{ importedText(lan.lastUpload) }}
            </div>
            <div v-else-if="lan.phase === 'error'" class="lan-result err">{{ lan.error }}</div>

            <div class="lan-actions">
              <button class="btn" @click="lanCopy(lanPrimaryUrl)">{{ t('data.lan.copyAddress') }}</button>
              <button class="btn" @click="lanCopy(lan.token)">{{ t('data.lan.copyToken') }}</button>
              <button class="btn ghost" @click="lanRegenerateToken">{{ t('data.lan.newToken') }}</button>
              <button class="btn ghost" @click="revealUploads">{{ t('data.lan.openFolder') }}</button>
              <button class="btn ghost" :disabled="lan.stopping" @click="lanDisable">
                {{ lan.stopping ? t('data.lan.stopping') : t('data.lan.stop') }}
              </button>
            </div>

            <div v-if="lan.urls.length > 1" class="lan-hint">
              {{ t('data.lan.altUrls') }}
              <code v-for="u in lan.urls.slice(1)" :key="u">{{ u }}</code>
            </div>
            <div v-if="lan.uploadDir" class="info-path">
              <span>{{ t('data.lan.uploadDir') }}</span>
              <code>{{ lan.uploadDir }}</code>
              <button class="link" @click="lanClearFiles">{{ t('data.lan.clearFiles') }}</button>
            </div>

            <ol class="lan-steps">
              <li>{{ t('data.lan.step1') }}</li>
              <li>{{ t('data.lan.step2') }}</li>
              <li>{{ t('data.lan.step3') }}</li>
            </ol>
          </div>
        </div>
        <div v-if="store.dataset" class="card">
          <div class="card-head">
            <h3>{{ t('data.current.title') }}</h3>
            <span class="badge ok">{{ t('data.current.ready') }}</span>
          </div>
          <div class="info-grid">
            <div class="info-item">
              <span>{{ t('data.current.account') }}</span>
              <b>{{ maskPhone(meta.packageName) }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.package') }}</span>
              <b>{{ meta.sourceKind === 'zip' ? t('data.current.packageZip') : t('data.current.packageFolder') }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.exportTime') }}</span>
              <b>{{ meta.exportTime ? meta.exportTime.replace('T', ' ').slice(0, 19) : '—' }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.generatedAt') }}</span>
              <b>{{ meta.generatedAt ? meta.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : '—' }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.rides') }}</span>
              <b>{{ t('data.current.ridesValue', { total: meta.ridesTotal, tracked: meta.ridesWithTrack }) }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.distanceDuration') }}</span>
              <b>{{ km(meta.distanceM) }} · {{ durationText(meta.durationMs) }}</b>
            </div>
            <div class="info-item">
              <span>{{ t('data.current.parseMs') }}</span>
              <b>{{ meta.parseMs }} ms</b>
            </div>
          </div>
          <div class="info-path">
            <span>{{ t('data.current.sourcePath') }}</span>
            <code>{{ meta.source }}</code>
            <button class="link" @click="reveal(meta.source)">{{ t('data.current.reveal') }}</button>
          </div>
          <div class="info-path">
            <span>{{ t('data.current.cachePath') }}</span>
            <code>{{ cachePath }}</code>
            <button class="link" @click="clearCache">{{ t('data.current.clearCache') }}</button>
          </div>
        </div>

        <div v-else class="card">
          <div class="card-head">
            <h3>{{ t('data.current.title') }}</h3>
            <span class="badge off">{{ t('data.current.notImported') }}</span>
          </div>
          <p class="lan-desc">{{ t('data.current.notImportedDesc') }}</p>
        </div>

      </template>

      <!-- 关于 -->
      <template v-else>
        <div class="settings-page-head">
          <div>
            <h2 class="settings-page-title">{{ t('settings.about') }}</h2>
            <p class="settings-page-sub">{{ t('settings.aboutSubtitle') }}</p>
          </div>
          <span class="badge ok">v{{ version || '—' }}</span>
        </div>

        <div class="card about-card">
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.version') }}</span>
            <b>Samsung Health Viz v{{ version || '—' }}</b>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.build') }}</span>
            <span class="muted">{{ buildInfo }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.updates') }}</span>
            <div class="segmented">
              <button class="btn primary small" :disabled="checkingUpdates" @click="checkUpdates">
                {{ checkingUpdates ? t('settings.checking') : t('settings.checkUpdates') }}
              </button>
              <button class="btn ghost small" @click="openReleasePage">{{ t('settings.openRelease') }}</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>{{ t('data.parsed.title') }}</h3></div>
          <ul class="note-list">
            <li v-html="t('data.parsed.item1')"></li>
            <li v-html="t('data.parsed.item2')"></li>
            <li v-html="t('data.parsed.item3')"></li>
            <li v-html="t('data.parsed.item4')"></li>
            <li v-html="t('data.parsed.item5')"></li>
          </ul>
          <div v-if="warnings.length" class="warn-box">
            <b>{{ t('data.parsed.warnings', { n: warnings.length }) }}</b>
            <ul>
              <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
            </ul>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>{{ t('data.notes.title') }}</h3></div>
          <ul class="note-list">
            <li v-html="t('data.notes.item1')"></li>
            <li v-html="t('data.notes.item2')"></li>
            <li v-html="t('data.notes.item3')"></li>
            <li v-html="t('data.notes.item4')"></li>
          </ul>
        </div>
      </template>
    </section>
  </div>
</template>
