<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { careerStats, yearStats, personalBests, monthHeat, yearColor, rideTooltipHtml } from '../lib/data.js';
import { km, speedKmh, durationText } from '../lib/format.js';
import { MAP_STYLE_OPTIONS } from '../lib/leaflet.js';
import StatCard from '../components/StatCard.vue';
import MapPanel from '../components/MapPanel.vue';
import BarChart from '../components/BarChart.vue';
import MonthHeatmap from '../components/MonthHeatmap.vue';

const router = useRouter();

/* 常见城市，用于给轨迹聚集区起个名字（定位在 80km 内才采用） */
const CITIES = [
  ['北京', 39.9042, 116.4074], ['上海', 31.2304, 121.4737], ['广州', 23.1291, 113.2644],
  ['深圳', 22.5431, 114.0579], ['杭州', 30.2741, 120.1551], ['南京', 32.0603, 118.7969],
  ['苏州', 31.2989, 120.5853], ['成都', 30.5728, 104.0668], ['重庆', 29.563, 106.5516],
  ['武汉', 30.5928, 114.3055], ['西安', 34.3416, 108.9398], ['天津', 39.3434, 117.3616],
  ['长沙', 28.2282, 112.9388], ['郑州', 34.7466, 113.6254], ['青岛', 36.0671, 120.3826],
  ['济南', 36.6512, 117.1201], ['沈阳', 41.8057, 123.4315], ['大连', 38.914, 121.6147],
  ['哈尔滨', 45.8038, 126.5349], ['长春', 43.8171, 125.3235], ['昆明', 25.0389, 102.7183],
  ['贵阳', 26.647, 106.6302], ['南宁', 22.817, 108.3665], ['海口', 20.0444, 110.1999],
  ['福州', 26.0745, 119.2965], ['厦门', 24.4798, 118.0894], ['合肥', 31.8206, 117.2272],
  ['南昌', 28.682, 115.8579], ['太原', 37.8706, 112.5489], ['石家庄', 38.0428, 114.5149],
  ['兰州', 36.0611, 103.8343], ['银川', 38.4872, 106.2309], ['西宁', 36.6171, 101.7782],
  ['乌鲁木齐', 43.8256, 87.6168], ['呼和浩特', 40.8426, 111.7492], ['拉萨', 29.652, 91.1721],
  ['香港', 22.3193, 114.1694], ['澳门', 22.1987, 113.5439], ['台北', 25.033, 121.5654],
  ['东京', 35.6762, 139.6503], ['首尔', 37.5665, 126.978], ['新加坡', 1.3521, 103.8198],
  ['伦敦', 51.5074, -0.1278], ['巴黎', 48.8566, 2.3522], ['纽约', 40.7128, -74.006],
  ['旧金山', 37.7749, -122.4194], ['温哥华', 49.2827, -123.1207], ['悉尼', -33.8688, 151.2093],
];

function distKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cityName(lat, lon) {
  let best = null;
  for (const [name, la, lo] of CITIES) {
    const d = distKm([lat, lon], [la, lo]);
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d < 80 ? best.name : null;
}

const rides = computed(() => store.dataset?.rides || []);
const stats = computed(() => careerStats(rides.value));
const years = computed(() => stats.value.years);
const rangeLabel = computed(() =>
  stats.value.first ? `${stats.value.first.replace(/-/g, '.')} — ${stats.value.last.replace(/-/g, '.')}` : ''
);

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
    label: cityName(g.center[0], g.center[1]) || `区域 ${i + 1}`,
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
    note: `${y.count} 次`,
  }))
);

const activeClusterLabel = computed(() => {
  if (clusterKey.value === 'all') return '全部区域';
  const c = clusters.value.find((x) => x.key === clusterKey.value);
  return c ? c.label : '全部区域';
});
const pb = computed(() => personalBests(rides.value));
const heat = computed(() => monthHeat(rides.value));
const recent = computed(() => [...rides.value].sort((a, b) => b.startMs - a.startMs).slice(0, 5));

function setYear(y) {
  store.yearFilter = String(y);
  clusterKey.value = 'all';
}
function openRide(id) {
  if (id) router.push(`/ride/${id}`);
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>骑行生涯</h1>
        <p class="page-sub">
          {{ rangeLabel }} · {{ stats.count }} 次骑行 · {{ stats.tracks }} 条轨迹 · 平均 {{ speedKmh(stats.avgSpeedMps) }}
        </p>
      </div>
      <div class="page-head-right">
        <span class="tag">仅统计骑行 · exercise_type 11007</span>
      </div>
    </div>

    <div class="kpi-grid">
      <StatCard label="总里程" :value="km(stats.distanceM)" :sub="`${stats.count} 次骑行`" accent />
      <StatCard label="总时长" :value="durationText(stats.durationMs)" sub="含所有骑行记录" />
      <StatCard label="累计爬升" :value="`${Math.round(stats.gainM)} m`" sub="三星估算 / GPS 海拔" />
      <StatCard label="总消耗" :value="`${Math.round(stats.calories).toLocaleString()} kcal`" />
      <StatCard label="平均速度" :value="speedKmh(stats.avgSpeedMps)" />
      <StatCard label="有轨迹" :value="`${stats.tracks} / ${stats.count}`" sub="可绘制到地图" />
    </div>

    <div class="career-top">
      <div class="card map-card">
        <div class="card-head">
          <h3>
            骑行路线
            <span class="muted small">{{ activeClusterLabel }} · {{ tracks.length }} 条轨迹</span>
          </h3>
          <label class="dim-control" title="底图淡化：调高后底图更淡，轨迹更突出">
            <span>底图淡化</span>
            <input v-model.number="store.mapDim" type="range" min="0" max="100" step="1" />
          </label>
          <select v-model="store.mapStyle" class="select">
            <option v-for="o in MAP_STYLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <div class="map-filters">
          <div class="chips">
            <button class="chip" :class="{ active: store.yearFilter === 'all' }" @click="setYear('all')">全部</button>
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
              全部区域 <em v-if="clusters.length > 1">{{ ridesWithTrack.length }}</em>
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

        <MapPanel mode="career" :tracks="tracks" :map-style="store.mapStyle" :dim="store.mapDim" @pick="openRide" />
        <div class="map-foot">
          <span v-for="y in years" :key="y" class="legend-item">
            <i :style="{ background: yearColor(`${y}-01-01`) }"></i>{{ y }}
          </span>
          <span class="muted small">悬停查看摘要 · 点击进入单次骑行</span>
        </div>
      </div>

      <div class="side-col">
        <div class="card">
          <div class="card-head"><h3>按年份</h3><span class="muted small">里程 / km</span></div>
          <BarChart :items="yearly" unit="km" :format="(v) => v.toFixed(1)" :height="150" />
        </div>
        <div class="card pb-card">
          <div class="card-head"><h3>个人最佳</h3></div>
          <ul class="pb-list">
            <li v-for="p in pb" :key="p.key" @click="openRide(p.ride.id)">
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
        <div class="card-head"><h3>骑行日历</h3><span class="muted small">颜色越深，当月里程越多</span></div>
        <MonthHeatmap :rows="heat.rows" :max="heat.max" />
      </div>
      <div class="card">
        <div class="card-head">
          <h3>最近骑行</h3>
          <button class="link" @click="router.push('/rides')">全部记录 →</button>
        </div>
        <ul class="mini-rides">
          <li v-for="r in recent" :key="r.id" @click="openRide(r.id)">
            <span class="mini-date">{{ r.date.slice(5, 10) }} <em>{{ r.start.slice(11, 16) }}</em></span>
            <span class="mini-main">{{ km(r.distanceM) }} · {{ durationText(r.durationMs) }}</span>
            <span class="mini-speed">{{ r.avgSpeedMps ? speedKmh(r.avgSpeedMps) : '—' }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
