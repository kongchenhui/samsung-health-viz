<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from '../store.js';

const route = useRoute();
const router = useRouter();

const navs = [
  { key: 'career', label: '生涯' },
  { key: 'rides', label: '骑行记录' },
  { key: 'data', label: '数据' },
];
const active = computed(() => (route.name === 'ride' ? 'career' : route.name));

const packageLabel = computed(() => {
  const name = store.dataset?.meta?.packageName || '';
  if (!name) return '本地数据包';
  return name.length > 7 ? `${name.slice(0, 3)}****${name.slice(-4)}` : name;
});
const exportLabel = computed(() => store.dataset?.meta?.exportTime?.slice(0, 10) || '');
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
        <b>三星健康可视化</b>
        <span>Samsung Health Viz · Cycling</span>
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
        数据包 · 账号 {{ packageLabel }}
        <em v-if="exportLabel">{{ exportLabel }} 导出</em>
      </span>
      <button v-if="store.dataset" class="btn ghost small" @click="router.push('/data')">数据包</button>
    </div>
  </header>
</template>
