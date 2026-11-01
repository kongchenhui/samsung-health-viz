<script setup>
import { computed, ref, watch } from 'vue';
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
  // 默认只展示最近 N 年：行数开放（用户骑得越久年份越多），
  // 全量渲染会让组件高度线性膨胀并撑高同一行的卡片，所以默认折叠。
  defaultYears: { type: Number, default: 3 },
});

/* 年份折叠状态：默认看最近 N 年，用户可主动展开全部。
 * 数据变化（换数据包、年份增减）时重置回默认，避免停在一个空扇区。 */
const expanded = ref(false);
watch(
  () => props.rows.map((r) => r.year).join(','),
  () => (expanded.value = false),
);

// rows 本身是升序（data.js 的 monthHeat 已排序），"最近"即末尾 N 年
const visibleRows = computed(() => {
  if (expanded.value || props.rows.length <= props.defaultYears) return props.rows;
  return props.rows.slice(-props.defaultYears);
});
const hiddenCount = computed(() => Math.max(0, props.rows.length - visibleRows.value.length));
// 按钮文案用的两个数字：折叠时提示「全部 N 个年份」，展开时提示「只看最近 N 年」
const totalYears = computed(() => props.rows.length);
const recentYears = computed(() => Math.min(props.defaultYears, props.rows.length));

const months = computed(() => Array.from({ length: 12 }, (_, i) => t('month.' + (i + 1))));

const years = computed(() => visibleRows.value.map((r) => String(r.year)));
const data = computed(() =>
  visibleRows.value.flatMap((row, yi) =>
    row.months.map((m, xi) => ({
      value: [xi, yi, Number((m.distanceM / 1000).toFixed(1))],
      count: m.count,
    }))
  )
);
/* 归一化上限来自 data.js 的 monthHeat（已用 P90 剔除异常月份），与天视图同一套规则。
 * 不直接用原始最大值：偶发一个超长月份会把其余月份全压到最浅一档。 */
const maxKm = computed(() => Math.max(0.001, props.max / 1000));
// 高度按**可见**行数算，折叠后不再随年份无限增长
const height = computed(() => Math.max(130, visibleRows.value.length * 54 + 54));

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
      // 连续色带（不分档）：与天视图共用同一组停靠点（含半透明低端），
      // 这样深浅两个主题下颜色观感一致，深色主题也不会出现刺眼的浅色块。
      text: [t('heatmap.more'), t('heatmap.less')],
      textStyle: { color: c.axis, fontSize: 10 },
      inRange: { color: c.heatStops.map((s) => s.color) },
    },
    series: [
      {
        type: 'heatmap',
        data: data.value.map((d) => ({
          ...d,
          // 没骑行的月份用「空格底色」，与天视图空格保持观感一致
          itemStyle: d.value[2] > 0 ? undefined : { color: c.heatDayEmpty },
          label: {
            // 深底写深色字会看不清，所以按「该格在色带上的位置」决定文字深浅：
            // 超过 32% 饱和度就用反色文字
            color: d.value[2] / maxKm.value > 0.32 ? c.heatHiLabel : c.heatLowLabel,
            show: d.value[2] > 0,
          },
        })),
        /* 空格（没骑行的月份）给一层和天视图相同的底色，而不是完全透明：
         * 透明时空月份只是一个黑洞，看不出「这里有格子、只是没数据」。 */
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
  <div class="heatmap-wrap">
    <div class="chart" :style="{ height: height + 'px' }">
      <VChart class="echart" :option="option" autoresize />
    </div>
    <!-- 年份多于默认展示数量时才出现：默认只看最近 N 年，全程由用户主动展开 -->
    <button v-if="hiddenCount > 0 || expanded" type="button" class="link heatmap-more" @click="expanded = !expanded">
      {{
        expanded
          ? t('career.calendarCollapse', { n: recentYears })
          : t('career.calendarShowAll', { n: totalYears })
      }}
    </button>
  </div>
</template>

<style scoped>
.heatmap-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.heatmap-more {
  align-self: flex-end;
}
</style>
