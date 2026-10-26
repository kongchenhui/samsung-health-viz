<script setup>
import { computed, onMounted } from 'vue';
import {
  store,
  lan,
  pickZip,
  pickFolder,
  showToast,
  refreshLanStatus,
  lanEnable,
  lanDisable,
  lanRegenerateToken,
  lanClearFiles,
  lanCopy,
} from '../store.js';
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

/* ---- 手机直传 ---- */
const lanPrimaryUrl = computed(() => lan.urls[0] || '');
const lanStateText = computed(() => {
  if (!lan.running) return '未开启';
  if (lan.phase === 'receiving') return '正在接收手机上传…';
  if (lan.phase === 'parsing') return '已收到，正在解析…';
  if (lan.phase === 'done') return '已导入';
  if (lan.phase === 'error') return '出错：' + (lan.error || '未知错误');
  return '等待手机上传';
});

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function receiveDetail(upload) {
  if (!upload) return '';
  const parts = [];
  if (upload.bytes && upload.receiveMs) {
    parts.push(`接收 ${fmtDuration(upload.receiveMs)} · ${(upload.bytes / (upload.receiveMs / 1000) / (1024 * 1024)).toFixed(1)} MB/s`);
  }
  if (upload.parseMs) parts.push(`解析 ${fmtDuration(upload.parseMs)}`);
  return parts.join(' · ');
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const lanSpeedText = computed(() => {
  if (lan.phase !== 'receiving' || !lan.startedAt || !lan.receivedBytes) return '';
  const secs = Math.max(1, (Date.now() - lan.startedAt) / 1000);
  const mbs = lan.receivedBytes / secs / (1024 * 1024);
  return `${mbs.toFixed(1)} MB/s`;
});

function revealUploads() {
  window.api.lanReveal();
}

onMounted(() => refreshLanStatus());
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

    <div class="card lan-card">
      <div class="card-head">
        <h3>手机直传（局域网）</h3>
        <span class="badge" :class="lan.running ? 'ok' : 'off'">
          {{ lan.running ? '接收中 · 端口 ' + lan.port : '未开启' }}
        </span>
      </div>
      <p class="lan-desc">
        在手机装上「Samsung Health Viz 直传」App，选中三星健康「下载个人数据」得到的导出目录，
        App 会自动打包成 ZIP 并上传到这台电脑——同一 Wi-Fi、不用数据线、不用手动拷文件。
        电脑端收到后自动解析并刷新数据。
      </p>

      <div v-if="!lan.running" class="lan-off">
        <button class="btn primary" :disabled="lan.starting" @click="lanEnable">
          {{ lan.starting ? '正在启动…' : '开启接收' }}
        </button>
        <span class="lan-hint">
          首次开启若系统询问防火墙权限，请允许「Samsung Health Viz」访问局域网。
        </span>
        <span v-if="lan.error" class="lan-error">{{ lan.error }}</span>
      </div>

      <div v-else class="lan-on">
        <div class="info-grid lan-grid">
          <div class="info-item">
            <span>电脑地址（手机 App 里填这个）</span>
            <b class="mono">{{ lanPrimaryUrl || '—' }}</b>
          </div>
          <div class="info-item">
            <span>令牌（6 位数字）</span>
            <b class="mono lan-token">{{ lan.token }}</b>
          </div>
          <div class="info-item">
            <span>状态</span>
            <b>{{ lanStateText }}</b>
          </div>
        </div>

        <div v-if="lan.phase === 'receiving' || lan.phase === 'parsing'" class="lan-progress">
          <div class="lan-progress-head">
            <span>{{ lan.uploadName || '手机正在上传…' }}</span>
            <span class="muted">
              {{ lan.phase === 'parsing' ? '解析中…' : `已接收 ${fmtBytes(lan.receivedBytes)}${lanSpeedText ? ' · ' + lanSpeedText : ''}` }}
            </span>
          </div>
          <div class="lan-bar"><i :class="{ parsing: lan.phase === 'parsing' }"></i></div>
        </div>

        <div v-if="lan.phase === 'done' && lan.lastUpload" class="lan-result ok">
          已导入 {{ lan.lastUpload.name || '手机上传的数据包' }}（{{ fmtBytes(lan.lastUpload.bytes) }}<template
            v-if="receiveDetail(lan.lastUpload)"
          > · {{ receiveDetail(lan.lastUpload) }}</template>）
        </div>
        <div v-else-if="lan.phase === 'error'" class="lan-result err">{{ lan.error }}</div>

        <div class="lan-actions">
          <button class="btn" @click="lanCopy(lanPrimaryUrl)">复制地址</button>
          <button class="btn" @click="lanCopy(lan.token)">复制令牌</button>
          <button class="btn ghost" @click="lanRegenerateToken">换一个令牌</button>
          <button class="btn ghost" @click="revealUploads">打开接收目录</button>
          <button class="btn ghost" :disabled="lan.stopping" @click="lanDisable">
            {{ lan.stopping ? '正在停止…' : '停止接收' }}
          </button>
        </div>

        <div v-if="lan.urls.length > 1" class="lan-hint">
          如果第一个地址连不上，换用：
          <code v-for="u in lan.urls.slice(1)" :key="u">{{ u }}</code>
        </div>
        <div v-if="lan.uploadDir" class="info-path">
          <span>接收目录</span>
          <code>{{ lan.uploadDir }}</code>
          <button class="link" @click="lanClearFiles">清除已接收文件</button>
        </div>

        <ol class="lan-steps">
          <li>手机与电脑连同一个 Wi-Fi；手机 App 会自动发现这台电脑，也可以用上面地址手动填。</li>
          <li>在 App 里输入令牌，选择三星健康导出目录，点「开始上传」。</li>
          <li>保持本页打开即可看到接收进度，完成后自动解析并更新缓存。</li>
        </ol>
      </div>
    </div>

    <div v-if="store.dataset" class="card">
      <div class="card-head"><h3>当前数据包</h3><span class="badge ok">已就绪</span></div>
      <div class="info-grid">
        <div class="info-item">
          <span>账号（手机号）</span>
          <b>{{ maskPhone(meta.packageName) }}</b>
        </div>
        <div class="info-item">
          <span>数据包</span>
          <b>{{ meta.sourceKind === 'zip' ? 'samsunghealth_*.zip' : '解压文件夹' }}</b>
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

    <div v-else class="card">
      <div class="card-head"><h3>当前数据包</h3><span class="badge off">尚未导入</span></div>
      <p class="lan-desc">
        还没有解析过数据包：可以用上方「手机直传」，或者点右上角「选择 ZIP / 选择文件夹」导入一次。
        解析结果缓存在本机，之后启动会直接打开。
      </p>
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
