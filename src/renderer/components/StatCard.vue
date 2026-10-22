<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: String, default: '—' },
  sub: { type: String, default: '' },
  accent: { type: Boolean, default: false },
});
</script>

<template>
  <div class="stat-card" :class="{ accent }">
    <span class="stat-label">{{ label }}</span>
    <strong class="stat-value">{{ value }}</strong>
    <span v-if="sub" class="stat-sub">{{ sub }}</span>
  </div>
</template>
