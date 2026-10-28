<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { km, speedKmh, durationText, weatherText } from '../lib/format.js';
import { yearColor } from '../lib/data.js';
import { t } from '../lib/i18n.js';

const router = useRouter();
const rides = computed(() => store.dataset?.rides || []);
const tracked = computed(() => rides.value.filter((r) => r.hasTrack).length);
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
  router.push({ name: 'ride', params: { id: r.id } });
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>{{ t('rides.title') }}</h1>
        <p class="page-sub">
          {{
            rides.length === 1
              ? t('rides.subtitle_one', { tracked })
              : t('rides.subtitle', { total: rides.length, tracked })
          }}
        </p>
      </div>
      <div class="page-head-right">
        <div class="chips">
          <button class="chip" :class="{ active: year === 'all' }" @click="year = 'all'">
            {{ t('rides.allYears') }}
          </button>
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
          <option value="date_desc">{{ t('rides.sortDateDesc') }}</option>
          <option value="date_asc">{{ t('rides.sortDateAsc') }}</option>
          <option value="dist_desc">{{ t('rides.sortDist') }}</option>
          <option value="dur_desc">{{ t('rides.sortDur') }}</option>
        </select>
      </div>
    </div>

    <div class="card table-card">
      <table class="ride-table">
        <thead>
          <tr>
            <th>{{ t('rides.thDate') }}</th>
            <th class="num">{{ t('rides.thDistance') }}</th>
            <th class="num">{{ t('rides.thDuration') }}</th>
            <th class="num">{{ t('rides.thAvgSpeed') }}</th>
            <th class="num">{{ t('rides.thGain') }}</th>
            <th class="num">{{ t('rides.thAvgHr') }}</th>
            <th>{{ t('rides.thWeather') }}</th>
            <th>{{ t('rides.thTrack') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in shown"
            :key="r.id"
            tabindex="0"
            role="button"
            @click="open(r)"
            @keydown.enter="open(r)"
            @keydown.space.prevent="open(r)"
          >
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
              <span v-if="r.weather" class="weather-inline"
                >{{ weatherText(r.weather.phrase) }} {{ r.weather.temperature }}°C</span
              >
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span class="badge" :class="r.hasTrack ? 'ok' : 'off'">{{
                r.hasTrack ? t('common.yes') : t('common.no')
              }}</span>
            </td>
          </tr>
          <tr v-if="!shown.length">
            <td colspan="8" class="empty-row">{{ t('rides.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
