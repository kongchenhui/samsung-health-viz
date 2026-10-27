<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { store, boot, parseTarget, pickZip, pickFolder, setupLanEvents, refreshLanStatus } from './store.js';
import TitleBar from './components/TitleBar.vue';
import ProgressOverlay from './components/ProgressOverlay.vue';
import ToastMessage from './components/ToastMessage.vue';
import StadiaKeyDialog from './components/StadiaKeyDialog.vue';
import WelcomeView from './views/WelcomeView.vue';

const unsubs = [];
const route = useRoute();
// 首次使用还没有数据包时也可以进「数据」页，从手机直传或手动选择数据包
const showWelcome = computed(() => !store.dataset && route.name !== 'data');

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

// 底图版权里的外链用系统浏览器打开，避免在应用内新开窗口
function onAttributionClick(e) {
  const link = e.target instanceof Element ? e.target.closest('.leaflet-control-attribution a') : null;
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (!/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  window.api.openExternal(href);
}

onMounted(async () => {
  await boot();
  unsubs.push(window.api.onMenuPickZip(() => pickZip()));
  unsubs.push(window.api.onMenuPickFolder(() => pickFolder()));
  // 局域网直传事件是全局的：无论当前在哪个页面，手机上传完成后都能收到并刷新数据
  unsubs.push(setupLanEvents());
  refreshLanStatus();
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  document.addEventListener('click', onAttributionClick);
});

onBeforeUnmount(() => {
  unsubs.forEach((u) => u && u());
  window.removeEventListener('dragover', onDragOver);
  window.removeEventListener('drop', onDrop);
  document.removeEventListener('click', onAttributionClick);
});
</script>

<template>
  <div class="app">
    <TitleBar />
    <main class="view">
      <WelcomeView v-if="showWelcome" />
      <router-view v-else v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
    <ProgressOverlay />
    <StadiaKeyDialog />
    <ToastMessage />
  </div>
</template>
