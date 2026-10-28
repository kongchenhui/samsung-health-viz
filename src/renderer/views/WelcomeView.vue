<script setup>
import { useRouter } from 'vue-router';
import { pickZip, pickFolder } from '../store.js';
import { t } from '../lib/i18n.js';

const router = useRouter();

/** 设置统一走路由拦截：这里只导航，主窗口会被 beforeEach 引导到独立设置窗口 */
function openSettings() {
  // 手机直传入口直接落到「数据」分栏
  router.push({ name: 'settings', query: { tab: 'data' } });
}
</script>

<template>
  <div class="welcome">
    <div class="welcome-card">
      <div class="welcome-badge">
        <svg viewBox="0 0 64 64" width="64" height="64">
          <defs>
            <linearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ffb02e" />
              <stop offset="1" stop-color="#2dd4bf" />
            </linearGradient>
          </defs>
          <circle cx="18" cy="44" r="9" fill="none" stroke="url(#wg)" stroke-width="2.6" />
          <circle cx="46" cy="44" r="9" fill="none" stroke="url(#wg)" stroke-width="2.6" />
          <path d="M18 44l10-16h12l6 16M28 28l6 16M40 28l-2-8h8" fill="none" stroke="#ffb02e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <h1>{{ t('welcome.title') }}</h1>
      <p class="welcome-sub">{{ t('welcome.sub') }}</p>

      <div class="dropzone">
        <span class="drop-icon">⤓</span>
        <b>{{ t('welcome.dropTitle') }}</b>
        <span class="muted" v-html="t('welcome.dropHint')"></span>
      </div>

      <div class="welcome-actions">
        <button class="btn primary" @click="pickZip()">{{ t('welcome.pickZip') }}</button>
        <button class="btn ghost" @click="pickFolder()">{{ t('welcome.pickFolder') }}</button>
        <button class="btn ghost" @click="openSettings">{{ t('welcome.lanLink') }}</button>
      </div>

      <p class="welcome-lan-hint">{{ t('welcome.lanHint') }}</p>

      <ol class="steps">
        <li v-html="t('welcome.step1')"></li>
        <li>{{ t('welcome.step2') }}</li>
        <li>{{ t('welcome.step3') }}</li>
      </ol>

      <p class="privacy">{{ t('welcome.privacy') }}</p>
    </div>
  </div>
</template>
