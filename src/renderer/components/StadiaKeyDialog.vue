<script setup>
import { nextTick, ref, watch } from 'vue';
import { store, cancelStadiaKeyDialog, saveStadiaKey } from '../store.js';

const key = ref('');
const inputEl = ref(null);

watch(
  () => store.stadiaKeyDialog.visible,
  async (visible) => {
    if (!visible) return;
    key.value = store.stadiaKey || '';
    await nextTick();
    inputEl.value?.focus();
    inputEl.value?.select();
  }
);

function save() {
  saveStadiaKey(key.value);
}

function openConsole() {
  window.api.openExternal('https://client.stadiamaps.com/dashboard/');
}
</script>

<template>
  <div v-if="store.stadiaKeyDialog.visible" class="overlay" @click.self="cancelStadiaKeyDialog">
    <div class="overlay-card stadia-dialog">
      <h3>Stadia 底图需要 API Key</h3>
      <p class="stadia-desc">
        Stadia Maps 的底图（Alidade / Outdoors / Stamen / OSM Bright）桌面端需要 API Key 才能加载瓦片。
        注册免费账号后在控制台生成 Key，粘贴到下面即可。
      </p>
      <input
        ref="inputEl"
        v-model="key"
        class="stadia-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="粘贴 Stadia API Key"
        @keydown.enter="save"
        @keydown.esc="cancelStadiaKeyDialog"
      />
      <p class="stadia-hint">
        Key 只保存在本机，不会写入仓库或安装包。
        <button class="link" @click="openConsole">打开 Stadia 控制台 →</button>
      </p>
      <div class="stadia-actions">
        <button class="btn ghost" @click="cancelStadiaKeyDialog">取消</button>
        <button class="btn primary" @click="save">保存并应用</button>
      </div>
    </div>
  </div>
</template>
