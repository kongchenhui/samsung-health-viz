<script setup>
import { computed } from 'vue';
import { store, pickZip, pickFolder, showToast } from '../store.js';
import { km, durationText } from '../lib/format.js';

const meta = computed(() => store.dataset?.meta || {});

function maskPhone(phone) {
  if (!phone) return '—';
  return phone.length > 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}
const warnings = computed(() => meta.value.warnings || []);
const cachePath = computed(() => store.info?.cachePath || '');

function reveal(path) {
  if (path) window.api.reveal(path);
}

async function clearCache() {
  await window.api.clear();
  store.dataset = null;
  showToast('已清除本地缓存，请重新选择数据包');
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>数据包</h1>
        <p class="page-sub">当前解析结果与数据来源；更换数据包会重新解析并覆盖本地缓存。</p>
      </div>
      <div class="page-head-right">
        <button class="btn primary" @click="pickZip()">选择 ZIP</button>
        <button class="btn ghost" @click="pickFolder()">选择文件夹</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>当前数据包</h3><span class="badge ok">已就绪</span></div>
      <div class="info-grid">
        <div class="info-item">
          <span>账号（手机号）</span>
          <b>{{ maskPhone(meta.packageName) }}</b>
        </div>
        <div class="info-item">
          <span>数据包</span>
          <b>{{ meta.packageName ? 'samsunghealth_*.zip' : '解压文件夹' }}</b>
        </div>
        <div class="info-item">
          <span>导出时间</span>
          <b>{{ meta.exportTime ? meta.exportTime.replace('T', ' ').slice(0, 19) : '—' }}</b>
        </div>
        <div class="info-item">
          <span>解析时间</span>
          <b>{{ meta.generatedAt ? meta.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : '—' }}</b>
        </div>
        <div class="info-item">
          <span>骑行记录</span>
          <b>{{ meta.ridesTotal }} 条（{{ meta.ridesWithTrack }} 条含轨迹）</b>
        </div>
        <div class="info-item">
          <span>总里程 / 总时长</span>
          <b>{{ km(meta.distanceM) }} · {{ durationText(meta.durationMs) }}</b>
        </div>
        <div class="info-item">
          <span>解析耗时</span>
          <b>{{ meta.parseMs }} ms</b>
        </div>
      </div>
      <div class="info-path">
        <span>数据包路径</span>
        <code>{{ meta.source }}</code>
        <button class="link" @click="reveal(meta.source)">打开位置</button>
      </div>
      <div class="info-path">
        <span>本地缓存</span>
        <code>{{ cachePath }}</code>
        <button class="link" @click="clearCache">清除缓存</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>解析了什么</h3></div>
      <ul class="note-list">
        <li><b>com.samsung.shealth.exercise.csv</b>：筛选运动类型 <code>11007</code>（骑行），读取起止时间、时长、距离、热量、爬升、平均/最大心率等汇总字段。</li>
        <li><b>jsons/com.samsung.shealth.exercise/*/UUID.location_data.json</b>：逐秒 GPS 点（经纬度、海拔、时间），经抽稀与 Douglas-Peucker 简化后作为地图轨迹。</li>
        <li><b>jsons/.../UUID.live_data.json</b>：运动过程采样，用于速度曲线与每公里分段；缺少时用距离增量估算。</li>
        <li><b>com.samsung.shealth.tracker.heart_rate.csv + binning_data.json</b>：当 live_data 没有心率时，用分钟级心率桶补齐心率曲线。</li>
        <li><b>exercise.weather / exercise.recovery_heart_rate</b>：按 exercise_id 关联天气与恢复心率。</li>
      </ul>
      <div v-if="warnings.length" class="warn-box">
        <b>解析警告（{{ warnings.length }}）</b>
        <ul>
          <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
        </ul>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>说明与边界</h3></div>
      <ul class="note-list">
        <li>本应用只读解析，不会修改原始数据包；所有数据留在本机。</li>
        <li>骑行类型判定基于三星内部编码 <code>11007</code>，若你的数据包中骑行使用了其他编码，需要在解析层扩展。</li>
        <li>地图坐标系：导出包没有显式基准字段，但手机写入的轨迹点带 <code>version</code>（GCJ-02），手表轨迹不带（WGS-84）；解析时按此判断，并按底图（高德 GCJ-02 / OSM·卫星 WGS-84）自动换算，无需手动处理。</li>
        <li>首期只做骑行；同一数据包里的步数、睡眠、心率等其他数据尚未接入可视化。</li>
      </ul>
    </div>
  </section>
</template>
