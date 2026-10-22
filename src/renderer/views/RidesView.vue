<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { km, speedKmh, durationText } from '../lib/format.js';
import { yearColor } from '../lib/data.js';

const router = useRouter();
const rides = computed(() => store.dataset?.rides || []);
const years = computed(() => [...new Set(rides.value.map((r) => Number(r.date.slice(0, 4))))].sort());
const year = ref('all');
const sort = ref('date_desc');

const shown = computed(() => {
  const list = rides.value.filter(
    (r) => year.value === 'all' || Number(r.date.slice(0, 4)) === Number(year.value)
  );
  const arr = [...list];
  if (sort.value === 'date_desc') arr.sort((a, b) => b.startMs - a.startMs);
  else if (sort.value === 'date_asc') arr.sort((a, b) => a.startMs - b.startMs);
  else if (sort.value === 'dist_desc') arr.sort((a, b) => (b.distanceM || 0) - (a.distanceM || 0));
  else if (sort.value === 'dur_desc') arr.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
  return arr;
});

function open(r) {
  router.push(`/ride/${r.id}`);
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>骑行记录</h1>
        <p class="page-sub">共 {{ rides.length }} 条骑行记录，其中 {{ rides.filter((r) => r.hasTrack).length }} 条带 GPS 轨迹</p>
      </div>
      <div class="page-head-right">
        <div class="chips">
          <button class="chip" :class="{ active: year === 'all' }" @click="year = 'all'">全部年份</button>
          <button
            v-for="y in years"
            :key="y"
            class="chip"
            :class="{ active: Number(year) === y }"
            @click="year = String(y)"
          >
            {{ y }}
          </button>
        </div>
        <select v-model="sort" class="select">
          <option value="date_desc">按时间（新→旧）</option>
          <option value="date_asc">按时间（旧→新）</option>
          <option value="dist_desc">按距离</option>
          <option value="dur_desc">按时长</option>
        </select>
      </div>
    </div>

    <div class="card table-card">
      <table class="ride-table">
        <thead>
          <tr>
            <th>日期</th>
            <th class="num">距离</th>
            <th class="num">时长</th>
            <th class="num">均速</th>
            <th class="num">爬升</th>
            <th class="num">均心率</th>
            <th>天气</th>
            <th>轨迹</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" @click="open(r)">
            <td>
              <span class="date-dot" :style="{ background: yearColor(r.date) }"></span>
              <b>{{ r.date.slice(0, 10) }}</b>
              <span class="muted ride-time">{{ r.start.slice(11, 16) }}</span>
            </td>
            <td class="num">{{ km(r.distanceM) }}</td>
            <td class="num">{{ durationText(r.durationMs) }}</td>
            <td class="num">{{ r.avgSpeedMps ? speedKmh(r.avgSpeedMps) : '—' }}</td>
            <td class="num">{{ r.elevGainM != null ? Math.round(r.elevGainM) + ' m' : '—' }}</td>
            <td class="num">{{ r.meanHr ? Math.round(r.meanHr) + ' bpm' : '—' }}</td>
            <td>
              <span v-if="r.weather" class="weather-inline">{{ r.weather.phrase }} {{ r.weather.temperature }}°C</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span class="badge" :class="r.hasTrack ? 'ok' : 'off'">{{ r.hasTrack ? '有' : '无' }}</span>
            </td>
          </tr>
          <tr v-if="!shown.length">
            <td colspan="8" class="empty-row">没有符合条件的骑行记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
