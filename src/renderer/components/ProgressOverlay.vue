<script setup>
import { progress } from '../store.js';
import { t } from '../lib/i18n.js';
</script>

<template>
  <transition name="fade">
    <div v-if="progress.visible" class="overlay">
      <div class="overlay-card">
        <div class="spinner"></div>
        <!-- 标题与消息用 aria-live 播报解析进度变化 -->
        <div aria-live="polite">
          <h3>{{ t('progress.title') }}</h3>
          <p class="progress-msg">{{ progress.message }}</p>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(progress.percent)"
        >
          <div class="progress-fill" :style="{ width: progress.percent + '%' }"></div>
        </div>
        <span class="progress-num">{{ Math.round(progress.percent) }}%</span>
      </div>
    </div>
  </transition>
</template>
