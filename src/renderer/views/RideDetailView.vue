<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { km, speedKmh, durationText, dateCN, weekdayCN, timeHM, paceText } from '../lib/format.js';
import { yearColor } from '../lib/data.js';
import { speedColor, MAP_STYLE_OPTIONS } from '../lib/leaflet.js';
import MapPanel from '../components/MapPanel.vue';
import LineChart from '../components/LineChart.vue';

const props = defineProps({ id: { type: String, default: null } });
const router = useRouter();

const ride = computed(() => (store.dataset?.rides || []).find((r) => r.id === props.id));

function percentile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];
}

const segments = computed(() => {
  const r = ride.value;
  if (!r || !r.hasTrack) return [];
  const { lat, lon, t } = r.track;
  const sp = (r.speed || []).filter((p) => p[1] > 0.3);
  if (!sp.length) {
    return [{ color: '#38bdf8', latlngs: lat.map((la, i) => [la, lon[i]]) }];
  }
  const speeds = sp.map((p) => p[1]);
  const p5 = percentile(speeds, 0.05);
  const p95 = percentile(speeds, 0.95);
  const ts = sp.map((p) => p[0]);
  const speedAt = (tt) => {
    let lo = 0;
    let hi = ts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] < tt) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const j = Math.max(0, i - 1);
    const a = sp[j];
    const b = sp[i];
    const dt = b[0] - a[0] || 1;
    const k = Math.min(1, Math.max(0, (tt - a[0]) / dt));
    return a[1] + (b[1] - a[1]) * k;
  };
  const runs = [];
  for (let i = 1; i < lat.length; i++) {
    const color = speedColor(speedAt(t[i]), p5, p95);
    const p1 = [lat[i - 1], lon[i - 1]];
    const p2 = [lat[i], lon[i]];
    const last = runs[runs.length - 1];
    if (!last || last.color !== color) runs.push({ color, latlngs: [p1, p2] });
    else last.latlngs.push(p2);
  }
  return runs;
});

const speedPoints = computed(() => (ride.value?.speed || []).map((p) => [p[0] / 60, p[1] * 3.6]));
const hrPoints = computed(() => (ride.value?.hr || []).map((p) => [p[0] / 60, p[1]]));
const altPoints = computed(() => {
  const r = ride.value;
  if (!r?.hasTrack) return [];
  const out = [];
  for (let i = 0; i < r.track.t.length; i++) {
    const alt = r.track.alt[i];
    if (alt == null || !Number.isFinite(alt)) continue;
    out.push([r.track.t[i] / 60, alt]);
  }
  return out;
});
const recoveryPoints = computed(() => (ride.value?.recoveryHr || []).map((p) => [p[0] / 60, p[1]]));

const splits = computed(() => ride.value?.splits || []);
const maxSplitSec = computed(() => Math.max(1, ...splits.value.map((s) => s.sec)));
const medianSplit = computed(() => {
  if (!splits.value.length) return null;
  const arr = [...splits.value.map((s) => s.sec)].sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
});

const stats = computed(() => {
  const r = ride.value;
  if (!r) return [];
  return [
    { label: '距离', value: km(r.distanceM) },
    { label: '时长', value: durationText(r.durationMs) },
    { label: '平均速度', value: r.avgSpeedMps ? speedKmh(r.avgSpeedMps) : '—' },
    { label: '最高速度', value: r.maxSpeedMps ? speedKmh(r.maxSpeedMps) : '—' },
    { label: '累计爬升', value: r.elevGainM != null ? Math.round(r.elevGainM) + ' m' : '—' },
    { label: '累计下降', value: r.elevLossM != null ? Math.round(r.elevLossM) + ' m' : '—' },
    { label: '消耗', value: r.calories != null ? Math.round(r.calories) + ' kcal' : '—' },
    { label: '平均心率', value: r.meanHr ? Math.round(r.meanHr) + ' bpm' : '—' },
    { label: '最高心率', value: r.maxHr ? Math.round(r.maxHr) + ' bpm' : '—' },
  ];
});
</script>

<template>
  <section v-if="ride" class="page">
    <div class="detail-head">
      <button class="btn ghost small" @click="router.push('/rides')">← 返回记录</button>
      <div class="detail-title">
        <div class="title-line">
          <span class="date-dot" :style="{ background: yearColor(ride.date) }"></span>
          <h1>{{ dateCN(ride.date) }}</h1>
          <span class="muted">{{ weekdayCN(ride.date) }}</span>
          <span v-if="!ride.hasTrack" class="tag warn">无 GPS 轨迹</span>
        </div>
        <p class="page-sub">
          {{ timeHM(ride.start) }} — {{ timeHM(ride.end) }}
          <template v-if="ride.weather">
            · {{ ride.weather.phrase }} {{ ride.weather.temperature }}°C · 湿度 {{ ride.weather.humidity }}% · 风速
            {{ ride.weather.windSpeed }} {{ ride.weather.windUnit }}
          </template>
        </p>
      </div>
    </div>

    <div class="kpi-grid detail-kpis">
      <div v-for="s in stats" :key="s.label" class="stat-card slim">
        <span class="stat-label">{{ s.label }}</span>
        <strong class="stat-value">{{ s.value }}</strong>
      </div>
    </div>

    <div class="card map-card detail-map-card">
      <div class="card-head">
        <h3>轨迹 <span class="muted small">{{ ride.hasTrack ? `${ride.track.lat.length} 个点` : '' }}</span></h3>
        <div class="card-tools">
          <div v-if="ride.hasTrack" class="speed-legend">
            <span>慢</span>
            <i class="speed-gradient"></i>
            <span>快</span>
          </div>
          <select v-model="store.mapStyle" class="select">
            <option v-for="o in MAP_STYLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
      </div>
      <MapPanel v-if="ride.hasTrack" mode="detail" :segments="segments" :map-style="store.mapStyle" />
      <div v-else class="map-empty">
        这次骑行没有记录 GPS 轨迹（可能手表未定位或为室内骑行），下方仍有速度/心率数据。
      </div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-head"><h3>速度</h3><span class="muted small">km/h</span></div>
        <LineChart
          :series="[{ name: '速度', color: '#38bdf8', points: speedPoints, area: true }]"
          :height="190"
          unit="km/h"
          x-unit="分钟"
          :y-format="(v) => v.toFixed(0)"
        />
      </div>
      <div class="card">
        <div class="card-head"><h3>心率</h3><span class="muted small">bpm</span></div>
        <LineChart
          :series="[{ name: '心率', color: '#f87171', points: hrPoints, area: true }]"
          :height="190"
          unit="bpm"
          x-unit="分钟"
          :y-format="(v) => v.toFixed(0)"
          empty="这次骑行没有心率记录"
        />
      </div>
      <div class="card">
        <div class="card-head"><h3>海拔</h3><span class="muted small">m</span></div>
        <LineChart
          :series="[{ name: '海拔', color: '#2dd4bf', points: altPoints, area: true }]"
          :height="190"
          unit="m"
          x-unit="分钟"
          :y-format="(v) => v.toFixed(0)"
          empty="这次骑行没有海拔数据"
        />
      </div>
      <div class="card">
        <div class="card-head"><h3>恢复心率</h3><span class="muted small">运动后</span></div>
        <LineChart
          :series="[{ name: '恢复心率', color: '#a78bfa', points: recoveryPoints, area: true }]"
          :height="190"
          unit="bpm"
          x-unit="分钟"
          :y-format="(v) => v.toFixed(0)"
          :x-format="(v) => v.toFixed(1)"
          empty="该次骑行没有恢复心率数据"
        />
      </div>
    </div>

    <div v-if="splits.length" class="card splits-card">
      <div class="card-head">
        <h3>分段配速</h3>
        <span class="muted small">共 {{ splits.length }} 段 · 中位配速 {{ paceText(medianSplit) }}/km</span>
      </div>
      <ul class="split-list">
        <li v-for="s in splits" :key="s.km">
          <span class="split-km">第 {{ s.km }} km</span>
          <div class="split-bar"><i :style="{ width: (s.sec / maxSplitSec) * 100 + '%' }"></i></div>
          <span class="split-pace">{{ paceText(s.sec) }}<em>/km</em></span>
        </li>
      </ul>
    </div>
  </section>

  <section v-else class="page">
    <div class="empty-state">
      <h2>没有找到这次骑行</h2>
      <p class="muted">可能是数据包已更换，返回记录列表重新选择。</p>
      <button class="btn ghost" @click="router.push('/rides')">返回记录</button>
    </div>
  </section>
</template>
