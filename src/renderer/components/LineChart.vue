<script setup>
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps({
  series: { type: Array, default: () => [] }, // [{ name, color, points: [[x, y]], area?: bool }]
  height: { type: Number, default: 200 },
  unit: { type: String, default: '' },
  xUnit: { type: String, default: '分钟' },
  yFormat: { type: Function, default: (v) => String(Math.round(v)) },
  xFormat: { type: Function, default: (v) => String(Math.round(v)) },
  empty: { type: String, default: '暂无数据' },
});

const hasData = computed(() =>
  props.series.some((s) => Array.isArray(s.points) && s.points.length > 1)
);

function rgba(hex, alpha) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const option = computed(() => {
  const series = props.series
    .filter((s) => Array.isArray(s.points) && s.points.length > 1)
    .map((s) => ({
      name: s.name,
      type: 'line',
      showSymbol: false,
      smooth: false,
      connectNulls: true,
      lineStyle: { width: 1.8, color: s.color },
      itemStyle: { color: s.color },
      areaStyle: s.area
        ? {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: rgba(s.color, 0.3) },
                { offset: 1, color: rgba(s.color, 0.02) },
              ],
            },
          }
        : undefined,
      data: s.points,
    }));

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(13,19,28,0.96)',
      borderColor: '#1e2a3a',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#e8eef7', fontSize: 11.5 },
      axisPointer: { type: 'line', lineStyle: { color: '#5b6b80', type: 'dashed' } },
      formatter: (params) => {
        if (!params.length) return '';
        const head = `<div style="color:#8a99ad;margin-bottom:4px">${Math.round(params[0].value[0])} ${props.xUnit}</div>`;
        const rows = params
          .map(
            (p) =>
              `<div style="display:flex;align-items:center;gap:6px">${p.marker}<span style="color:#c3cfdd">${p.seriesName}</span><b style="margin-left:auto;padding-left:12px">${props.yFormat(p.value[1])} ${props.unit}</b></div>`
          )
          .join('');
        return head + rows;
      },
    },
    xAxis: {
      type: 'value',
      min: 'dataMin',
      max: 'dataMax',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: '#8a99ad', fontSize: 10.5, formatter: (v) => props.xFormat(v) },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: '#8a99ad', fontSize: 10.5, formatter: (v) => props.yFormat(v) },
    },
    series,
  };
});
</script>

<template>
  <div class="chart" :style="{ height: height + 'px' }">
    <VChart v-if="hasData" class="echart" :option="option" autoresize />
    <div v-else class="chart-empty">{{ empty }}</div>
  </div>
</template>
