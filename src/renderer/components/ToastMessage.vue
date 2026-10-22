<script setup>
import { toast } from '../store.js';
</script>

<template>
  <transition name="toast">
    <div v-if="toast.visible" class="toast" :class="toast.type">{{ toast.message }}</div>
  </transition>
</template>
