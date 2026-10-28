<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, setMapStyle } from '../store.js';
import { careerStats, yearStats, personalBests, monthHeat, yearColor, rideTooltipHtml } from '../lib/data.js';
import { km, speedKmh, durationText } from '../lib/format.js';
import { MAP_STYLE_OPTIONS } from '../lib/leaflet.js';
import { t, tPlural } from '../lib/i18n.js';
import { distKm, cityName } from '../lib/cities.js';
import StatCard from '../components/StatCard.vue';
import MapPanel from '../components/MapPanel.vue';
import BarChart from '../components/BarChart.vue';
import MonthHeatmap from '../components/MonthHeatmap.vue';

const router = useRouter();

const rides = computed(() => store.dataset?.rides || []);
const stats = computed(() => careerStats(rides.value));
const years = computed(() => stats.value.years);
const rangeLabel = computed(() => {
  const first = stats.value.first;
  const last = stats.value.last;
  if (!first) return '';
  const start = first.replace(/-/g, '.');
  // 只有一条记录时首尾同日，不再打印重复区间
  if (!last || first === last) return start;
  return `${start} — ${last.replace(/-/g, '.')}`;
});

const filteredRides = computed(() => {
  if (store.yearFilter === 'all') return rides.value;
  return rides.value.filter((r) => Number(r.date.slice(0, 4)) === Number(store.yearFilter));
});

/* 轨迹按“起点距离 < 80km”聚成区域，便于在城市间快速切换 */
const ridesWithTrack = computed(() => filteredRides.value.filter((r) => r.hasTrack));

const clusters = computed(() => {
  const groups = [];
  for (const r of ridesWithTrack.value) {
    const start = [r.track.lat[0], r.track.lon[0]];
    let group = groups.find((g) => distKm(g.center, start) < 80);
    if (!group) {
      group = { center: start, rides: [] };
      groups.push(group);
    }
    group.rides.push(r);
  }
  groups.sort((a, b) => b.rides.length - a.rides.length);
  return groups.map((g, i) => ({
    key: `c${i}`,
    label: cityName(g.center[0], g.center[1]) || t('career.area', { n: i + 1 }),
    count: g.rides.length,
    rides: g.rides,
    center: g.center,
  }));
});

const clusterKey = ref('c0');
watch(
  () => store.yearFilter,
  () => (clusterKey.value = clusters.value.length ? clusters.value[0].key : 'all')
);
watch(clusters, (list) => {
  if (!list.length) clusterKey.value = 'all';
  else if (clusterKey.value !== 'all' && !list.some((c) => c.key === clusterKey.value)) {
    clusterKey.value = list[0].key;
  }
});

const visibleRides = computed(() => {
  if (clusterKey.value === 'all') return ridesWithTrack.value;
  const c = clusters.value.find((x) => x.key === clusterKey.value);
  return c ? c.rides : ridesWithTrack.value;
});

const tracks = computed(() =>
  visibleRides.value.map((r) => ({
    id: r.id,
    color: yearColor(r.date),
    points: r.track.lat.map((lat, i) => [lat, r.track.lon[i]]),
    // 每条轨迹的坐标基准（手表 wgs84 / 手机 gcj02），混绘时必须逐条带上，否则会整体偏移
    coordSys: r.coordSys || 'wgs84',
    tooltipHtml: rideTooltipHtml(r),
    opacity: store.yearFilter === 'all' ? 0.7 : 0.92,
    weight: clusterKey.value === 'all' ? 3 : 4,
  }))
);

const yearly = computed(() =>
  yearStats(rides.value).map((y) => ({
    label: String(y.year),
    value: Number((y.distanceM / 1000).toFixed(1)),
    color: yearColor(`${y.year}-01-01`),
    note: tPlural(y.count, 'career.ridesCount'),
  }))
);

const activeClusterLabel = computed(() => {
  if (clusterKey.value === 'all') return t('career.allAreas');
  const c = clusters.value.find((x) => x.key === clusterKey.value);
  return c ? c.label : t('career.allAreas');
});
const pb = computed(() => personalBests(rides.value));
const heat = computed(() => monthHeat(rides.value));
const recent = computed(() => [...rides.value].sort((a, b) => b.startMs - a.startMs).slice(0, 5));

function setYear(y) {
  store.yearFilter = String(y);
  clusterKey.value = 'all';
}
function openRide(id) {
  if (id) router.push({ name: 'ride', params: { id } });
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>{{ t('career.title') }}</h1>
        <p class="page-sub">
          {{
            stats.count === 1
              ? t('career.subtitle_one', {
                  range: rangeLabel,
                  tracks: stats.tracks,
                  speed: speedKmh(stats.avgSpeedMps),
                })
              : t('career.subtitle', {
                  range: rangeLabel,
                  count: stats.count,
                  tracks: stats.tracks,
                  speed: speedKmh(stats.avgSpeedMps),
                })
          }}
        </p>
      </div>
    </div>

    <div class="kpi-grid">
      <StatCard
        :label="t('career.totalDistance')"
        :value="km(stats.distanceM)"
        :sub="tPlural(stats.count, 'career.ridesCount')"
        accent
      />
      <StatCard
        :label="t('career.totalTime')"
        :value="durationText(stats.durationMs)"
        :sub="t('career.totalTimeSub')"
      />
      <StatCard
        :label="t('career.totalGain')"
        :value="`${Math.round(stats.gainM)} m`"
        :sub="t('career.totalGainSub')"
      />
      <StatCard :label="t('career.totalCalories')" :value="`${Math.round(stats.calories).toLocaleString()} kcal`" />
      <StatCard :label="t('career.avgSpeed')" :value="speedKmh(stats.avgSpeedMps)" />
      <StatCard
        :label="t('career.withTrack')"
        :value="`${stats.tracks} / ${stats.count}`"
        :sub="t('career.withTrackSub')"
      />
    </div>

    <div class="career-top">
      <div v-if="tracks.length" class="card map-card">
        <div class="card-head">
          <h3>
            {{ t('career.routes') }}
            <span class="muted small">{{
              t('career.tracksCount', { label: activeClusterLabel, n: tracks.length })
            }}</span>
          </h3>
          <label class="dim-control" :title="t('career.dimBasemapTip')">
            <span>{{ t('career.dimBasemap') }}</span>
            <input v-model.number="store.mapDim" type="range" min="0" max="100" step="1" />
          </label>
          <select
            class="select"
            :value="store.mapStyle"
            :aria-label="t('career.routes')"
            @change="setMapStyle($event.target.value)"
          >
            <option v-for="o in MAP_STYLE_OPTIONS" :key="o.value" :value="o.value">{{ t(o.label) }}</option>
          </select>
        </div>

        <div class="map-filters">
          <div class="chips">
            <button class="chip" :class="{ active: store.yearFilter === 'all' }" @click="setYear('all')">
              {{ t('common.all') }}
            </button>
            <button
              v-for="y in years"
              :key="y"
              class="chip"
              :class="{ active: Number(store.yearFilter) === y }"
              @click="setYear(y)"
            >
              {{ y }}
            </button>
          </div>
          <span class="filter-sep"></span>
          <div class="chips">
            <button class="chip" :class="{ active: clusterKey === 'all' }" @click="clusterKey = 'all'">
              {{ t('career.allAreas') }} <em v-if="clusters.length > 1">{{ ridesWithTrack.length }}</em>
            </button>
            <button
              v-for="c in clusters"
              :key="c.key"
              class="chip"
              :class="{ active: clusterKey === c.key }"
              @click="clusterKey = c.key"
            >
              {{ c.label }} <em>{{ c.count }}</em>
            </button>
          </div>
        </div>

        <MapPanel
          mode="career"
          :tracks="tracks"
          :map-style="store.mapStyle"
          :stadia-key="store.stadiaKey"
          :dim="store.mapDim"
          @pick="openRide"
        />
        <div class="map-foot">
          <span v-for="y in years" :key="y" class="legend-item">
            <i :style="{ background: yearColor(`${y}-01-01`) }"></i>{{ y }}
          </span>
          <span class="muted small">{{ t('career.mapFootHint') }}</span>
        </div>
      </div>
      <div v-else class="card map-empty-card">
        <p class="muted">{{ t('career.noTrackData') }}</p>
      </div>

      <div class="side-col">
        <div class="card">
          <div class="card-head">
            <h3>{{ t('career.byYear') }}</h3>
            <span class="muted small">{{ t('career.distancePerKm') }}</span>
          </div>
          <BarChart :items="yearly" unit="km" :format="(v) => v.toFixed(1)" :height="150" />
        </div>
        <div class="card pb-card">
          <div class="card-head"><h3>{{ t('career.personalBests') }}</h3></div>
          <ul class="pb-list">
            <li
              v-for="p in pb"
              :key="p.key"
              tabindex="0"
              role="button"
              @click="openRide(p.ride.id)"
              @keydown.enter="openRide(p.ride.id)"
              @keydown.space.prevent="openRide(p.ride.id)"
            >
              <span class="pb-label">{{ p.label }}</span>
              <b>{{ p.value }}</b>
              <span class="pb-date">{{ p.ride.date.slice(5, 10) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="career-bottom">
      <div class="card">
        <div class="card-head">
          <h3>{{ t('career.calendar') }}</h3>
          <span class="muted small">{{ t('career.calendarHint') }}</span>
        </div>
        <MonthHeatmap :rows="heat.rows" :max="heat.max" />
      </div>
      <div class="card">
        <div class="card-head">
          <h3>{{ t('career.recent') }}</h3>
          <button class="link" @click="router.push('/rides')">{{ t('career.allRecords') }}</button>
        </div>
        <ul class="mini-rides">
          <li
            v-for="r in recent"
            :key="r.id"
            tabindex="0"
            role="button"
            @click="openRide(r.id)"
            @keydown.enter="openRide(r.id)"
            @keydown.space.prevent="openRide(r.id)"
          >
            <span class="mini-date">{{ r.date.slice(5, 10) }} <em>{{ r.start.slice(11, 16) }}</em></span>
            <span class="mini-main">{{ km(r.distanceM) }} · {{ durationText(r.durationMs) }}</span>
            <span class="mini-speed">{{ r.avgSpeedMps ? speedKmh(r.avgSpeedMps) : '—' }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 无 GPS 轨迹时替代地图卡片的提示（复用 .card 外观，只做居中与高度对齐） */
.map-empty-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 440px;
  text-align: center;
}
.map-empty-card p {
  margin: 0;
}
</style>
