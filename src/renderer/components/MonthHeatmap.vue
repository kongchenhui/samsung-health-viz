<script setup>
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const props = defineProps({
  rows: { type: Array, default: () => [] }, // [{ year, months: [{ month, distanceM, count }] }]
  max: { type: Number, default: 1 },
});

const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

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

const option = computed(() => ({
  animation: false,
  backgroundColor: 'transparent',
  grid: { left: 48, right: 74, top: 8, bottom: 30 },
  tooltip: {
    confine: true,
    backgroundColor: 'rgba(13,19,28,0.96)',
    borderColor: '#1e2a3a',
    textStyle: { color: '#e8eef7', fontSize: 11.5 },
    formatter: (p) => {
      const year = years.value[p.value[1]];
      const month = p.value[0] + 1;
      if (!p.value[2]) return `${year} 年 ${month} 月<br/><span style="color:#8a99ad">没有骑行</span>`;
      return `<b>${year} 年 ${month} 月</b><br/>${p.value[2]} km · ${p.data.count} 次`;
    },
  },
  xAxis: {
    type: 'category',
    data: months,
    splitArea: { show: false },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#8a99ad', fontSize: 10.5 },
  },
  yAxis: {
    type: 'category',
    data: years.value,
    splitArea: { show: false },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#8a99ad', fontSize: 11 },
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
    text: ['多', '少'],
    textStyle: { color: '#8a99ad', fontSize: 10 },
    inRange: { color: ['rgba(255,176,46,0.08)', 'rgba(255,176,46,0.35)', 'rgba(255,176,46,0.7)', '#ffb02e'] },
  },
  series: [
    {
      type: 'heatmap',
      data: data.value.map((d) => ({
        ...d,
        label: {
          color: d.value[2] > maxKm.value * 0.32 ? 'rgba(8,11,18,0.78)' : '#aeb9c9',
        },
      })),
      itemStyle: { borderRadius: 6, borderColor: '#0b0f16', borderWidth: 2 },
      label: {
        show: true,
        fontSize: 9.5,
        fontWeight: 600,
        formatter: (p) => (p.value[2] ? p.value[2] : ''),
      },
      emphasis: { itemStyle: { borderColor: '#ffd27a', borderWidth: 1.5 } },
    },
  ],
}));
</script>

<template>
  <div class="chart" :style="{ height: height + 'px' }">
    <VChart class="echart" :option="option" autoresize />
  </div>
</template>
