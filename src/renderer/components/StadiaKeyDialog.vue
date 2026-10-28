<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { store, cancelStadiaKeyDialog, saveStadiaKey } from '../store.js';
import { t } from '../lib/i18n.js';

const key = ref('');
const inputEl = ref(null);
let lastFocused = null;

// 弹窗打开期间监听 document 级 Esc；input 上不再单独绑定 Esc，避免一次按键触发两次取消
function onDocKeydown(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  cancelStadiaKeyDialog();
}

watch(
  () => store.stadiaKeyDialog.visible,
  async (visible) => {
    if (visible) {
      // 记录打开前的焦点，关闭后还原（键盘/读屏用户不会被丢回页首）
      lastFocused = document.activeElement;
      document.addEventListener('keydown', onDocKeydown);
      key.value = store.stadiaKey || '';
      await nextTick();
      inputEl.value?.focus();
      inputEl.value?.select();
      return;
    }
    document.removeEventListener('keydown', onDocKeydown);
    // 等 v-if 把弹窗 DOM 移除后再还原焦点
    await nextTick();
    const target = lastFocused;
    lastFocused = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus();
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown);
});

function save() {
  saveStadiaKey(key.value);
}

function openConsole() {
  window.api.openExternal('https://client.stadiamaps.com/dashboard/');
}
</script>

<template>
  <div
    v-if="store.stadiaKeyDialog.visible"
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="stadia-dialog-title"
    @click.self="cancelStadiaKeyDialog"
  >
    <div class="overlay-card stadia-dialog">
      <h3 id="stadia-dialog-title">{{ t('data.stadia.dialogTitle') }}</h3>
      <p class="stadia-desc">{{ t('data.stadia.dialogDesc') }}</p>
      <input
        ref="inputEl"
        v-model="key"
        class="stadia-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('data.stadia.placeholder')"
        @keydown.enter="save"
      />
      <p class="stadia-hint">
        {{ t('data.stadia.dialogHint') }}
        <button class="link" @click="openConsole">{{ t('data.stadia.openConsole') }}</button>
      </p>
      <div class="stadia-actions">
        <button class="btn ghost" @click="cancelStadiaKeyDialog">{{ t('common.cancel') }}</button>
        <button class="btn primary" @click="save">{{ t('data.stadia.saveAndApply') }}</button>
      </div>
    </div>
  </div>
</template>
