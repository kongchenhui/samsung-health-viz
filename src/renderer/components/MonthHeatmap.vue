<script setup>
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { store } from '../store.js';
import { chartColors } from '../lib/palette.js';
import { t } from '../lib/i18n.js';
import { monthTitle } from '../lib/format.js';

use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const props = defineProps({
  rows: { type: Array, default: () => [] }, // [{ year, months: [{ month, distanceM, count }] }]
  max: { type: Number, default: 1 },
});

const months = computed(() => Array.from({ length: 12 }, (_, i) => t('month.' + (i + 1))));

const years = computed(() => props.rows.map((r) => String(r.year)));
const data = computed(() =>
  props.rows.flatMap((row, yi) =>
    row.months.map((m, xi) => ({
      value: [xi, yi, Number((m.distanceM / 1000).toFixed(1))],
      count: m.count,
    }))
  )
);
const maxKm = computed(() => Math.max(1, props.max / 1000));
const height = computed(() => Math.max(130, props.rows.length * 54 + 54));

const option = computed(() => {
  // 依赖 store.theme 与当前语言：切换后重算配色与文案
  void store.theme;
  const c = chartColors();
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 48, right: 74, top: 8, bottom: 30 },
    tooltip: {
      confine: true,
      backgroundColor: c.tipBg,
      borderColor: c.tipBorder,
      textStyle: { color: c.tipText, fontSize: 11.5 },
      formatter: (p) => {
        const year = years.value[p.value[1]];
        const month = p.value[0] + 1;
        const title = t('heatmap.tipTitle', { title: monthTitle(year, month) });
        if (!p.value[2]) return `${title}<br/><span style="color:${c.tipMuted}">${t('heatmap.noRides')}</span>`;
        return `<b>${title}</b><br/>${t('heatmap.tip', { km: p.value[2], n: p.data.count })}`;
      },
    },
    xAxis: {
      type: 'category',
      data: months.value,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.axis, fontSize: 10.5 },
    },
    yAxis: {
      type: 'category',
      data: years.value,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.axis, fontSize: 11 },
    },
    visualMap: {
      min: 0,
      max: maxKm.value,
      show: true,
      orient: 'vertical',
      right: 6,
      top: 'center',
      itemWidth: 10,
      itemHeight: 78,
      text: [t('heatmap.more'), t('heatmap.less')],
      textStyle: { color: c.axis, fontSize: 10 },
      inRange: { color: c.heatRange },
    },
    series: [
      {
        type: 'heatmap',
        data: data.value.map((d) => ({
          ...d,
          label: {
            color: d.value[2] > maxKm.value * 0.32 ? c.heatHiLabel : c.heatLowLabel,
          },
        })),
        itemStyle: { borderRadius: 6, borderColor: c.heatGap, borderWidth: 2 },
        label: {
          show: true,
          fontSize: 9.5,
          fontWeight: 600,
          formatter: (p) => (p.value[2] ? p.value[2] : ''),
        },
        emphasis: { itemStyle: { borderColor: c.emphasis, borderWidth: 1.5 } },
      },
    ],
  };
});
</script>

<template>
  <div class="chart" :style="{ height: height + 'px' }">
    <VChart class="echart" :option="option" autoresize />
  </div>
</template>
