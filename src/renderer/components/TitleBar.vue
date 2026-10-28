<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from '../store.js';
import { t } from '../lib/i18n.js';

const route = useRoute();
const router = useRouter();

const navs = computed(() => [
  { key: 'career', label: t('nav.career') },
  { key: 'rides', label: t('nav.rides') },
]);
// 骑行详情页属于「骑行记录」的下钻页：无论从哪里进入，导航都高亮「骑行记录」
const active = computed(() => (route.name === 'ride' ? 'rides' : route.name));

const packageLabel = computed(() => {
  const name = store.dataset?.meta?.packageName || '';
  if (!name) return t('titlebar.localPackage');
  return name.length > 7 ? `${name.slice(0, 3)}****${name.slice(-4)}` : name;
});
const exportLabel = computed(() => store.dataset?.meta?.exportTime?.slice(0, 10) || '');

// 设置统一走路由拦截：主窗口 push /settings 后由 router.beforeEach 打开独立设置窗口
function openSettings() {
  router.push('/settings');
}
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <span class="brand-logo" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="26" height="26">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ffb02e" />
              <stop offset="1" stop-color="#2dd4bf" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="13.5" fill="none" stroke="url(#g1)" stroke-width="2.4" />
          <path
            d="M9.5 20.5l4.2-6.4 3.4 4.4 3.1-5 3.3 7"
            fill="none"
            stroke="#ffb02e"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <div class="brand-text">
        <b>{{ t('brand.name') }}</b>
        <span>{{ t('brand.sub') }}</span>
      </div>
    </div>

    <nav v-if="store.dataset" class="nav">
      <button
        v-for="n in navs"
        :key="n.key"
        class="nav-pill"
        :class="{ active: active === n.key }"
        @click="router.push('/' + n.key)"
      >
        {{ n.label }}
      </button>
    </nav>

    <div class="titlebar-actions">
      <span v-if="store.dataset" class="source-chip">
        <span class="chip-dot"></span>
        {{ t('titlebar.sourceChip', { name: packageLabel }) }}
        <em v-if="exportLabel">{{ t('titlebar.exported', { date: exportLabel }) }}</em>
      </span>
      <!-- 设置：数据包 / 主题 / 语言 / 底图偏好 在独立窗口中配置 -->
      <button
        class="icon-btn"
        :class="{ active: route.name === 'settings' }"
        :title="t('settings.title')"
        :aria-label="t('settings.title')"
        @click="openSettings"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    </div>
  </header>
</template>
