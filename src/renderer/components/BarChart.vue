<script setup>
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps({
  items: { type: Array, default: () => [] }, // [{ label, value, color, note }]
  height: { type: Number, default: 170 },
  unit: { type: String, default: '' },
  format: { type: Function, default: (v) => String(Math.round(v)) },
});

const option = computed(() => ({
  animation: false,
  backgroundColor: 'transparent',
  grid: { left: 8, right: 8, top: 28, bottom: 26 },
  tooltip: {
    trigger: 'axis',
    confine: true,
    backgroundColor: 'rgba(13,19,28,0.96)',
    borderColor: '#1e2a3a',
    textStyle: { color: '#e8eef7', fontSize: 11.5 },
    axisPointer: { type: 'none' },
    formatter: (params) => {
      const p = params[0];
      const item = props.items[p.dataIndex] || {};
      return `<b>${p.name}</b><br/>${props.format(p.value)} ${props.unit}${item.note ? ` · ${item.note}` : ''}`;
    },
  },
  xAxis: {
    type: 'category',
    data: props.items.map((i) => i.label),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#8a99ad', fontSize: 10.5 },
  },
  yAxis: { type: 'value', show: false },
  series: [
    {
      type: 'bar',
      barMaxWidth: 46,
      data: props.items.map((i) => ({
        value: i.value,
        itemStyle: { color: i.color || '#38bdf8', borderRadius: [5, 5, 0, 0], opacity: 0.9 },
      })),
      label: {
        show: true,
        position: 'top',
        color: '#c3cfdd',
        fontSize: 10.5,
        formatter: (p) => props.format(p.value),
      },
    },
  ],
}));
</script>

<template>
  <div class="chart" :style="{ height: height + 'px' }">
    <VChart class="echart" :option="option" autoresize />
  </div>
</template>
