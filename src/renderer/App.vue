<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { store, boot, parseTarget, pickZip, pickFolder } from './store.js';
import TitleBar from './components/TitleBar.vue';
import ProgressOverlay from './components/ProgressOverlay.vue';
import ToastMessage from './components/ToastMessage.vue';
import WelcomeView from './views/WelcomeView.vue';

const unsubs = [];

function onDragOver(e) {
  e.preventDefault();
}
function onDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const p = window.api.getPathForFile(file);
  if (p) parseTarget(p);
}

onMounted(async () => {
  await boot();
  unsubs.push(window.api.onMenuPickZip(() => pickZip()));
  unsubs.push(window.api.onMenuPickFolder(() => pickFolder()));
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
});

onBeforeUnmount(() => {
  unsubs.forEach((u) => u && u());
  window.removeEventListener('dragover', onDragOver);
  window.removeEventListener('drop', onDrop);
});
</script>

<template>
  <div class="app">
    <TitleBar />
    <main class="view">
      <WelcomeView v-if="!store.dataset" />
      <router-view v-else v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
    <ProgressOverlay />
    <ToastMessage />
  </div>
</template>
