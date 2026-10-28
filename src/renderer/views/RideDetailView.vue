<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { store, setMapStyle } from '../store.js';
import { km, speedKmh, durationText, dateText, weekdayText, timeHM, paceText, weatherText } from '../lib/format.js';
import { yearColor } from '../lib/data.js';
import { speedColor, MAP_STYLE_OPTIONS } from '../lib/leaflet.js';
import { chartColors } from '../lib/palette.js';
import { t } from '../lib/i18n.js';
import MapPanel from '../components/MapPanel.vue';
import LineChart from '../components/LineChart.vue';

const props = defineProps({ id: { type: String, default: null } });
const router = useRouter();

const ride = computed(() => (store.dataset?.rides || []).find((r) => r.id === props.id));

// 图表系列色随主题重算（暗色亮色各一套，Canvas 绘制拿不到 CSS 变量）
const seriesColors = computed(() => chartColors().series);

function percentile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];
}

const segments = computed(() => {
  const r = ride.value;
  if (!r || !r.hasTrack) return [];
  const { lat, lon, t } = r.track;
  const sp = (r.speed || []).filter((p) => p[1] > 0.3);
  const themeColors = chartColors();
  if (!sp.length) {
    const [rr, gg, bb] = themeColors.speedStops[0][1];
    return [{ color: `rgb(${rr}, ${gg}, ${bb})`, latlngs: lat.map((la, i) => [la, lon[i]]) }];
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
    const color = speedColor(speedAt(t[i]), p5, p95, themeColors.speedStops);
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
    { label: t('detail.distance'), value: km(r.distanceM) },
    { label: t('detail.duration'), value: durationText(r.durationMs) },
    { label: t('detail.avgSpeed'), value: r.avgSpeedMps ? speedKmh(r.avgSpeedMps) : '—' },
    { label: t('detail.maxSpeed'), value: r.maxSpeedMps ? speedKmh(r.maxSpeedMps) : '—' },
    { label: t('detail.gain'), value: r.elevGainM != null ? Math.round(r.elevGainM) + ' m' : '—' },
    { label: t('detail.loss'), value: r.elevLossM != null ? Math.round(r.elevLossM) + ' m' : '—' },
    { label: t('detail.calories'), value: r.calories != null ? Math.round(r.calories) + ' kcal' : '—' },
    { label: t('detail.avgHr'), value: r.meanHr ? Math.round(r.meanHr) + ' bpm' : '—' },
    { label: t('detail.maxHr'), value: r.maxHr ? Math.round(r.maxHr) + ' bpm' : '—' },
  ];
});
</script>

<template>
  <section v-if="ride" class="page">
    <div class="detail-head">
      <button class="btn ghost small" @click="router.push('/rides')">{{ t('detail.back') }}</button>
      <div class="detail-title">
        <div class="title-line">
          <span class="date-dot" :style="{ background: yearColor(ride.date) }"></span>
          <h1>{{ dateText(ride.date) }}</h1>
          <span class="muted">{{ weekdayText(ride.date) }}</span>
          <span v-if="!ride.hasTrack" class="tag warn">{{ t('detail.noTrack') }}</span>
        </div>
        <p class="page-sub">
          {{ timeHM(ride.start) }} — {{ timeHM(ride.end) }}
          <template v-if="ride.weather">
            · {{ weatherText(ride.weather.phrase) }} {{ ride.weather.temperature }}°C ·
            {{
              t('detail.humidityWind', {
                humidity: ride.weather.humidity,
                wind: ride.weather.windSpeed,
                unit: ride.weather.windUnit,
              })
            }}
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
        <h3>
          {{ t('detail.track') }}
          <span class="muted small">{{ ride.hasTrack ? t('detail.points', { n: ride.track.lat.length }) : '' }}</span>
        </h3>
        <div class="card-tools">
          <div v-if="ride.hasTrack" class="speed-legend">
            <span>{{ t('detail.slow') }}</span>
            <i class="speed-gradient"></i>
            <span>{{ t('detail.fast') }}</span>
          </div>
          <label class="dim-control" :title="t('career.dimBasemapTip')">
            <span>{{ t('career.dimBasemap') }}</span>
            <input v-model.number="store.mapDim" type="range" min="0" max="100" step="1" />
          </label>
          <select
            class="select"
            :value="store.mapStyle"
            :aria-label="t('detail.track')"
            @change="setMapStyle($event.target.value)"
          >
            <option v-for="o in MAP_STYLE_OPTIONS" :key="o.value" :value="o.value">{{ t(o.label) }}</option>
          </select>
        </div>
      </div>
      <MapPanel
        v-if="ride.hasTrack"
        mode="detail"
        :segments="segments"
        :map-style="store.mapStyle"
        :stadia-key="store.stadiaKey"
        :coord-sys="ride.coordSys || 'wgs84'"
        :dim="store.mapDim"
      />
      <div v-else class="map-empty">{{ t('detail.noTrackDesc') }}</div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-head"><h3>{{ t('detail.speed') }}</h3><span class="muted small">km/h</span></div>
        <LineChart
          :series="[{ name: t('detail.speed'), color: seriesColors.speed, points: speedPoints, area: true }]"
          :height="190"
          unit="km/h"
          :x-unit="t('common.min')"
          :y-format="(v) => v.toFixed(0)"
        />
      </div>
      <div class="card">
        <div class="card-head"><h3>{{ t('detail.hr') }}</h3><span class="muted small">bpm</span></div>
        <LineChart
          :series="[{ name: t('detail.hr'), color: seriesColors.hr, points: hrPoints, area: true }]"
          :height="190"
          unit="bpm"
          :x-unit="t('common.min')"
          :y-format="(v) => v.toFixed(0)"
          :empty="t('detail.emptyHr')"
        />
      </div>
      <div class="card">
        <div class="card-head"><h3>{{ t('detail.altitude') }}</h3><span class="muted small">m</span></div>
        <LineChart
          :series="[{ name: t('detail.altitude'), color: seriesColors.altitude, points: altPoints, area: true }]"
          :height="190"
          unit="m"
          :x-unit="t('common.min')"
          :y-format="(v) => v.toFixed(0)"
          :empty="t('detail.emptyAlt')"
        />
      </div>
      <div class="card">
        <div class="card-head">
          <h3>{{ t('detail.recovery') }}</h3>
          <span class="muted small">{{ t('detail.recoverySub') }}</span>
        </div>
        <LineChart
          :series="[{ name: t('detail.recovery'), color: seriesColors.recovery, points: recoveryPoints, area: true }]"
          :height="190"
          unit="bpm"
          :x-unit="t('common.min')"
          :y-format="(v) => v.toFixed(0)"
          :x-format="(v) => v.toFixed(1)"
          :empty="t('detail.emptyRecovery')"
        />
      </div>
    </div>

    <div v-if="splits.length" class="card splits-card">
      <div class="card-head">
        <h3>{{ t('detail.splits') }}</h3>
        <span class="muted small">{{
          t('detail.splitsSub', { n: splits.length, pace: paceText(medianSplit) })
        }}</span>
      </div>
      <ul class="split-list">
        <li v-for="s in splits" :key="s.km">
          <span class="split-km">{{ t('detail.splitKm', { n: s.km }) }}</span>
          <div class="split-bar"><i :style="{ width: (s.sec / maxSplitSec) * 100 + '%' }"></i></div>
          <span class="split-pace">{{ paceText(s.sec) }}<em>/km</em></span>
        </li>
      </ul>
    </div>
  </section>

  <section v-else class="page">
    <div class="empty-state">
      <h2>{{ t('detail.notFound') }}</h2>
      <p class="muted">{{ t('detail.notFoundDesc') }}</p>
      <button class="btn ghost" @click="router.push('/rides')">{{ t('detail.backToList') }}</button>
    </div>
  </section>
</template>
