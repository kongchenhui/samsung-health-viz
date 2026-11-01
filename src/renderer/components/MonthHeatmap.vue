<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import VChart from 'vue-echarts';
import HeatLegendBar from './HeatLegendBar.vue';
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
/* 归一化上限来自 data.js 的 monthHeat（已用 P90 剔除异常月份），与日视图同一套规则。
 * 不直接用原始最大值：偶发一个超长月份会把其余月份全压到最浅一档。 */
const maxKm = computed(() => Math.max(0.001, props.max / 1000));
// 高度按**可见**行数算，折叠后不再随年份无限增长
const height = computed(() => Math.max(130, visibleRows.value.length * 54 + 54));

/* 色带悬停联动：与日视图同一套逻辑（组件回传值域区间，这里高亮命中的月份格）。
 * 月视图的格子是 ECharts 画的，所以用 dispatchAction 的 highlight/downplay 推动画状态，
 * 而不是像日视图那样改 class。 */
const chartRef = ref(null);
/* 悬停某个月份格时，把这个格的里程传给色带组件，指示器会挪到色带对应位置
 * （对应 ECharts 的 _hoverLinkFromSeriesMouseOver：悬停数据 → 指示器跟随）。 */
const hoverValueM = ref(null);
function chartInstance() {
  const c = chartRef.value;
  return c?.chart || c || null;
}
/* 悬停格子 → 色带指示器跟随。
 * 同时监听 mouseover 和 mousemove：只在 mouseover 上监听的话，在相邻格子之间滑动时
 * 偶尔收不到新事件（ECharts 对同一 series 内部的移动不重复派发 mouseover）。
 * 用 key 去重，避免 mousemove 每次都触发响应式更新。 */
let lastHoverKey = null;
function onChartMove(params) {
  /* 注意空格子也要有反馈：月份没有骑行时 value 是 0，
   * 指针同样应当落到色带最「少」的一端，标签显示 0。
   * 只有鼠标在图表空白处（没有任何数据点）时才清空。 */
  const hasCell = Array.isArray(params?.value) && Number.isFinite(Number(params.value[2]));
  const v = hasCell ? Number(params.value[2]) : null;
  const key = hasCell ? String(v) : '';
  if (key === lastHoverKey) return;
  lastHoverKey = key;
  hoverValueM.value = hasCell ? v * 1000 : null;
}
function onChartOut() {
  lastHoverKey = null;
  hoverValueM.value = null;
}
onMounted(() => {
  const inst = chartInstance();
  if (!inst?.on) return;
  inst.on('mouseover', onChartMove);
  inst.on('mousemove', onChartMove);
  // 鼠标离开整个图表时收起（mouseout 在格子之间移动也会触发，用 globalout 更准）
  inst.on('globalout', onChartOut);
});
function dispatch(action) {
  // vue-echarts 把 echarts 实例的方法代理到组件实例上，取不到时退回 .chart
  const inst = chartRef.value;
  const fn = inst?.dispatchAction || inst?.chart?.dispatchAction;
  if (fn) fn.call(inst?.dispatchAction ? inst : inst.chart, action);
}
function onLegendHover(range) {
  dispatch({ type: 'downplay', seriesIndex: 0 });
  if (!range) return;
  const dataIndex = [];
  data.value.forEach((d, i) => {
    const meters = d.value[2] * 1000;
    if (d.value[2] > 0 && meters >= range.loVal && meters <= range.hiVal) dataIndex.push(i);
  });
  if (dataIndex.length) dispatch({ type: 'highlight', seriesIndex: 0, dataIndex });
}

const option = computed(() => {
  // 依赖 store.theme 与当前语言：切换后重算配色与文案
  void store.theme;
  const c = chartColors();
  return {
    animation: false,
    backgroundColor: 'transparent',
    /* 右侧预留只需容纳悬停时浮出来的「≈ 224」标签（约 30px），
     * 留太多会在最后一列与色带之间空出一整格宽的死白。
     * 32 + 间隙 5 = 最后一列到色带左缘 37px，标签（最宽约「≈ 402」）刚好落在预留区内。 */
    grid: { left: 48, right: 32, top: 8, bottom: 30 },
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
    /* visualMap 仍要保留——ECharts 的 heatmap 靠它把数值映射成颜色；
     * 但不再显示它自带的色带（show: false），视觉上的色带由 HeatLegendBar 画，
     * 这样天/月两个视图的色带是同一个组件，圆角、滑块、字号完全一致。 */
    visualMap: {
      min: 0,
      max: maxKm.value,
      show: false,
      inRange: { color: c.heatStops.map((s) => s.color) },
    },
    series: [
      {
        type: 'heatmap',
        data: data.value.map((d) => ({
          ...d,
          // 没骑行的月份用「空格底色」，与日视图空格保持观感一致
          itemStyle: d.value[2] > 0 ? undefined : { color: c.heatDayEmpty },
          label: {
            // 深底写深色字会看不清，所以按「该格在色带上的位置」决定文字深浅：
            // 超过 32% 饱和度就用反色文字
            color: d.value[2] / maxKm.value > 0.32 ? c.heatHiLabel : c.heatLowLabel,
            show: d.value[2] > 0,
          },
        })),
        /* 空格（没骑行的月份）给一层和日视图相同的底色，而不是完全透明：
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
    <!-- 图表 + 竖向色带并排：色带放在日历右侧，与原来的 ECharts visualMap 位置一致 -->
    <div class="heatmap-body">
      <div class="chart" :style="{ height: height + 'px' }">
        <VChart ref="chartRef" class="echart" :option="option" autoresize />
      </div>
      <HeatLegendBar
        orient="vertical"
        :max-m="props.max"
        :active-value-m="hoverValueM"
        @hover="onLegendHover"
      />
    </div>
    <div class="heatmap-foot">
      <!-- 年份多于默认展示数量时才出现：默认只看最近 N 年，全程由用户主动展开 -->
      <button v-if="hiddenCount > 0 || expanded" type="button" class="link" @click="expanded = !expanded">
        {{
          expanded
            ? t('career.calendarCollapse', { n: recentYears })
            : t('career.calendarShowAll', { n: totalYears })
        }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.heatmap-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
/* 图表占满剩余宽度，竖向色带固定在右侧并垂直居中 */
.heatmap-body {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  /* 色带右缘与卡片内容右缘留 7px，与旧版 visualMap 的 right: 6 视觉一致 */
  padding-right: 7px;
}
.heatmap-body .chart {
  flex: 1;
  min-width: 0;
}
.heatmap-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}
</style>
