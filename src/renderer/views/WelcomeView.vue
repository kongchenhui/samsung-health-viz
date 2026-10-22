<script setup>
import { pickZip, pickFolder } from '../store.js';
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
      <h1>把三星健康数据画在地图上</h1>
      <p class="welcome-sub">
        导入三星健康（Samsung Health）导出的数据包，自动解析骑行记录与 GPS 轨迹，生成本地地图与统计。首期为骑行模块，后续将扩展到步数、睡眠、心率等更多数据。
      </p>

      <div class="dropzone">
        <span class="drop-icon">⤓</span>
        <b>拖拽数据包到这里</b>
        <span class="muted">支持 <code>samsunghealth_*.zip</code> 或解压后的文件夹</span>
      </div>

      <div class="welcome-actions">
        <button class="btn primary" @click="pickZip()">选择 ZIP 数据包</button>
        <button class="btn ghost" @click="pickFolder()">选择解压文件夹</button>
      </div>

      <ol class="steps">
        <li>手机三星健康 App → 设置 → 下载个人数据，得到 <code>samsunghealth_&lt;手机号&gt;_&lt;时间&gt;.zip</code></li>
        <li>在这里选择该 ZIP（或先解压后选择文件夹），解析出骑行记录与轨迹</li>
        <li>解析完成后进入「生涯」页；数据只在本机处理，可随时在「数据」页更换数据包</li>
      </ol>

      <p class="privacy">🔒 所有解析都在本机完成，数据包不会上传；解析结果缓存在应用数据目录。</p>
    </div>
  </div>
</template>
