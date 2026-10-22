<script setup>
import { progress } from '../store.js';
</script>

<template>
  <transition name="fade">
    <div v-if="progress.visible" class="overlay">
      <div class="overlay-card">
        <div class="spinner"></div>
        <h3>正在解析数据包</h3>
        <p class="progress-msg">{{ progress.message }}</p>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progress.percent + '%' }"></div>
        </div>
        <span class="progress-num">{{ Math.round(progress.percent) }}%</span>
      </div>
    </div>
  </transition>
</template>
