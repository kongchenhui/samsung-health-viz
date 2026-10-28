<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  store,
  boot,
  parseTarget,
  setupLanEvents,
  refreshLanStatus,
  setupCrossWindowSync,
} from './store.js';
import TitleBar from './components/TitleBar.vue';
import ProgressOverlay from './components/ProgressOverlay.vue';
import ToastMessage from './components/ToastMessage.vue';
import StadiaKeyDialog from './components/StadiaKeyDialog.vue';
import WelcomeView from './views/WelcomeView.vue';
import SettingsView from './views/SettingsView.vue';

const unsubs = [];
const route = useRoute();
// 设置是独立窗口：该窗口只渲染设置页，不渲染主窗口的标题栏/导航/欢迎页
const isSettingsWindow = window.api?.windowKind === 'settings';
// 首次使用还没有数据包时也可以进「设置」页，从手机直传或手动选择数据包
const showWelcome = computed(() => !isSettingsWindow && !store.dataset && route.name !== 'settings');

/* ---------- 页面滚动位置记忆 ----------
 * 主窗口所有路由共用同一个 <main class="view"> 滚动容器；不处理的话切换页面会沿用
 * 上一页的 scrollTop（表现就是“滚动条位置共享/不对”）。这里按 route.fullPath 记住每个
 * 页面离开时的位置，进入新页面时还原（第一次进入即回到顶部）；返回列表页自然回到原位。
 */
const viewEl = ref(null);
const scrollPositions = new Map();
watch(
  () => route.fullPath,
  async (to, from) => {
    const el = viewEl.value;
    if (!el) return;
    if (from) scrollPositions.set(from, el.scrollTop);
    // 等新页面渲染完再还原：此时容器高度才是新页面的，scrollTop 不会被浏览器夹掉
    await nextTick();
    if (route.fullPath !== to) return; // 期间又跳了，交给下一次 watch 处理
    if (viewEl.value) viewEl.value.scrollTop = scrollPositions.get(to) ?? 0;
  },
);

// 清空数据包后回到欢迎页：欢迎页不沿用其它页面的滚动位置
watch(showWelcome, async (welcoming) => {
  if (!welcoming) return;
  await nextTick();
  if (viewEl.value) viewEl.value.scrollTop = 0;
});

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
  // 多窗口同步：主题/语言/数据包变更由主进程广播，主窗口与设置窗口保持一致
  unsubs.push(setupCrossWindowSync());
  // 局域网直传事件是全局的：无论当前在哪个页面，手机上传完成后都能收到并刷新数据
  unsubs.push(setupLanEvents());
  refreshLanStatus();
  if (!isSettingsWindow) {
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    document.addEventListener('click', onAttributionClick);
  }
});

onBeforeUnmount(() => {
  unsubs.forEach((u) => u && u());
  window.removeEventListener('dragover', onDragOver);
  window.removeEventListener('drop', onDrop);
  document.removeEventListener('click', onAttributionClick);
});
</script>

<template>
  <div class="app" :class="{ 'app--settings-window': isSettingsWindow }">
    <template v-if="isSettingsWindow">
      <main class="view view-settings">
        <SettingsView />
      </main>
    </template>
    <template v-else>
      <TitleBar />
      <main ref="viewEl" class="view">
        <WelcomeView v-if="showWelcome" />
        <router-view v-else v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </template>
    <ProgressOverlay />
    <StadiaKeyDialog />
    <ToastMessage />
  </div>
</template>
