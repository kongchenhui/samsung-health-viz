<script setup>
import { computed, ref } from 'vue';
import { store } from '../store.js';
import { chartColors } from '../lib/palette.js';
import { km } from '../lib/format.js';
import { t, tPlural } from '../lib/i18n.js';
import { yearHeat, todayIso } from '../lib/calendar.js';
import { sampleGradient } from '../lib/color-scale.js';
import HeatLegendBar from './HeatLegendBar.vue';

/* 日视图（GitHub 贡献图样式的近一年日历）。
 * 为什么不用 ECharts 的 calendar 图表：那边要自己算坐标轴范围、格子尺寸和月份标签位置，
 * 而这里的需求只是「7 行 × 53 列的方块 + 月份标签」，纯 CSS grid 更稳：
 * 尺寸跟随容器宽度自适应、悬停用原生 tooltip、明暗主题靠 CSS 变量，且不必为它注册图表组件。 */
const props = defineProps({
  rides: { type: Array, default: () => [] },
});

/* 每列第一天是周几：由语言文件决定（中文周一起、英文周日起）。
 * 这是展示格式而非用户偏好，所以放 src/locales 的 format 段，不在代码里按语言写死分支。 */
const weekStart = computed(() => (Number(t('format.weekStart')) === 1 ? 1 : 0));

// 数据变了才重算；today 每次渲染都取会让 computed 永远失效，所以只在 setup 里取一次，
// 并把「数据最后一条比今天还新」的情况交给 yearHeat 内部处理。
const today = todayIso();
const heat = computed(() => yearHeat(props.rides, { today, weekStart: weekStart.value }));

// 热力档位 → 具体颜色。图表色板是 JS 算的（Canvas 那套也用），这里复用以保证两套主题一致。
const colors = computed(() => {
  void store.theme; // 依赖主题：切换明暗后要重新取色
  return chartColors();
});
const emptyColor = computed(() => colors.value.heatDayEmpty);
/* 连续取色：按 cell.t（0-1 的里程强度）在热力色带上插值，不再分档。
 * 这样 20km 和 60km 一定不同色，颜色深浅与里程严格单调对应。 */
const cellColor = (cell) =>
  cell.t > 0 ? sampleGradient(cell.t, 0, 1, colors.value.heatStops) : emptyColor.value;

const dayLabels = computed(() =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => t('format.weekdays.' + ((d + weekStart.value) % 7))),
);
const monthName = (m) => t('month.' + m);
/* 星期标签只标 3 行（周一 / 周三 / 周五），和 GitHub 贡献图一致：
 * 7 行全标时行距只有 11-14px，标签会挤成一团糊字。
 * 判断依据是「这一行是星期几」而不是行号奇偶——行号 parity 在首列是周日时会把第 7 行（周六）
 * 也标出来，变成 4 个标签。 */
function showDayLabel(d) {
  const weekday = (weekStart.value + d) % 7;
  return weekday === 1 || weekday === 3 || weekday === 5;
}

const laneStyle = computed(() => ({
  gridTemplateColumns: `repeat(${heat.value.grid.length}, minmax(0, 1fr))`,
}));
/* 色带悬停联动：组件只回传值域区间，这里据此决定高亮哪些格子。 */
const barRange = ref(null);
function onLegendHover(range) {
  barRange.value = range;
}
/* 落在光标值域区间内的所有格子（聚合高亮）。
 * 用原始里程比较而不是 cell.t：cell.t 为了「极小值也看得见」做过下限夹取，
 * 拿它当区间判据会让边界差一点点。 */
const linkedCells = computed(() => {
  const b = barRange.value;
  if (!b) return [];
  return heat.value.grid
    .flat()
    .filter((c) => !c.future && c.distanceM > 0 && c.distanceM >= b.loVal && c.distanceM <= b.hiVal);
});
const linkedSet = computed(() => new Set(linkedCells.value.map((c) => c.iso)));

/* 悬停样式与月视图（ECharts heatmap）保持同一套 token，避免两种视图观感割裂：
 * - 描边用 emphasis（月视图 emphasis.itemStyle.borderColor 就是这个），琥珀色而非黑色；
 * - 浮层背景/边框/文字用 tipBg / tipBorder / tipText，与 ECharts tooltip 一致。 */
const rootStyle = computed(() => {
  const c = colors.value;
  return {
    '--dayheat-hover': c.emphasis,
    '--dayheat-tip-bg': c.tipBg,
    '--dayheat-tip-border': c.tipBorder,
    '--dayheat-tip-text': c.tipText,
    '--dayheat-tip-muted': c.tipMuted,
  };
});

/* ---------------- 悬停浮层 ----------------
 * 为什么不用原生 title：浏览器自带的 title 有 1 秒左右延迟、样式完全不可控，
 * 而且这一屏有 371 个格子，用户扫一眼就要马上看到数值。这里自己画一个跟主题走的浮层：
 * 位置跟着被悬停的格子走，靠近右/下边缘时翻到另一侧，避免溢出卡片。 */
const hover = ref(null); // { cell, x, y, flipX, flipY }
const wrapEl = ref(null);

function onCellEnter(cell, event) {
  if (cell.future) {
    hover.value = null;
    return;
  }
  const wrap = wrapEl.value;
  if (!wrap) return;
  const box = wrap.getBoundingClientRect();
  const target = event.currentTarget.getBoundingClientRect();
  // 浮层宽约 150、高约 52：贴着格子中心，超出容器右/下侧就翻到另一侧
  const anchorX = target.left - box.left + target.width / 2;
  const anchorY = target.top - box.top;
  hover.value = {
    cell,
    x: anchorX,
    y: anchorY,
    flipX: anchorX > box.width - 90,
    flipY: anchorY < 60,
  };
}
function onCellLeave() {
  hover.value = null;
}

/* 月份标签贴合真实的列位置：53 列等宽时，一个月大约占 4.3 列，
 * 直接用「第 n 个月放第 n*4.3 列」会逐渐漂移，所以用 calendar.js 算好的 col。
 * 每个标签的跨度截到「下一标签开始前」为止：跨度固定 4 列时相邻标签会重叠一格，
 * 而标签带 overflow: hidden，重叠会把前一个标签的末字裁掉。 */
const monthLabelStyle = (col) => {
  const labels = heat.value.monthLabels;
  const idx = labels.findIndex((m) => m.col === col);
  const next = labels[idx + 1];
  const end = Math.min(next ? next.col : heat.value.grid.length, col + 4);
  return { gridColumn: `${col + 1} / span ${Math.max(1, end - col)}` };
};

/* 悬停文案拆成两行：第一行日期，第二行里程 / 次数。
 * 合成一行在窄浮层里会折行，两行固定结构更好读，也方便给数值单独上色。 */
function cellDate(cell) {
  return `${cell.iso.slice(0, 4)}.${cell.iso.slice(5, 10).replace('-', '.')}`;
}
function cellDetail(cell) {
  if (!cell.count) return t('calendar.dayNoRide');
  return tPlural(cell.count, 'calendar.dayTip', { dist: km(cell.distanceM), n: cell.count });
}
// 无障碍：无法悬停时（读屏 / 键盘）仍能拿到一段完整描述
function cellTitle(cell) {
  return cell.future ? '' : `${cellDate(cell)} · ${cellDetail(cell)}`;
}
</script>

<template>
  <div ref="wrapEl" class="dayheat" :style="rootStyle">
    <!-- 月份标签行：与格子网格同宽，靠 grid-column 对齐到具体列 -->
    <div class="dayheat-months" :style="laneStyle" aria-hidden="true">
      <span v-for="m in heat.monthLabels" :key="m.col" :style="monthLabelStyle(m.col)">{{ monthName(m.month) }}</span>
    </div>

    <div class="dayheat-body">
      <!-- 左侧星期标签：只标三行，避免 7 行全标把小尺寸行高撑开 -->
      <div class="dayheat-days" aria-hidden="true">
        <span v-for="(label, d) in dayLabels" :key="d" :class="{ dim: !showDayLabel(d) }">
          {{ showDayLabel(d) ? label : '·' }}
        </span>
      </div>

      <div class="dayheat-grid" :style="laneStyle" role="grid" :aria-label="t('calendar.dayHint')">
        <div v-for="(week, c) in heat.grid" :key="c" class="dayheat-col" role="row">
          <i
            v-for="cell in week"
            :key="cell.iso"
            class="dayheat-cell"
            :class="{ future: cell.future, linked: linkedSet.has(cell.iso) }"
            :style="{ background: cell.future ? 'transparent' : cellColor(cell) }"
            :title="cellTitle(cell)"
            :data-date="cell.iso"
            :data-t="cell.t"
            @mouseenter="onCellEnter(cell, $event)"
            @mouseleave="onCellLeave"
          ></i>
        </div>
      </div>
    </div>

    <div class="dayheat-foot">
      <span class="muted small">
        {{ heat.empty ? t('calendar.dayEmpty') : t('calendar.daySummary', { n: heat.activeDays, dist: km(heat.totalDistanceM) }) }}
      </span>
      <!-- 色带图例：与月视图共用同一个组件，两个视图观感一致 -->
      <!-- 悬停格子时把该格里程传进去，指示器会跟着挪到色带对应位置（ECharts 的 series→visualMap 联动） -->
      <HeatLegendBar
        :max-m="heat.scaleMaxM"
        :active-value-m="hover?.cell?.distanceM ?? null"
        @hover="onLegendHover"
      />
    </div>

    <!-- 悬停浮层：结构与文案对齐月视图的 ECharts tooltip（标题加粗 + 详情一行） -->
    <div
      v-if="hover"
      class="dayheat-tip"
      :class="{ 'flip-x': hover.flipX, 'flip-y': hover.flipY }"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
      role="status"
    >
      <b>{{ cellDate(hover.cell) }}</b>
      <span>{{ cellDetail(hover.cell) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 尺寸全部用 CSS 变量：格子宽度由列数（53）均分容器，容器窄时整体等比缩小，
 * 不会像固定 px 那样在窄窗口里溢出成横向滚动条。 */
.dayheat {
  --gap: 3px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  /* 宽屏下不让网格无限拉宽：53 列均分整张卡时格子会变成 20px+ 的大色块，
     反而盖过卡片的视觉重心。上限按「格子最大约 15px」反算：
     53×15 + 52×3(缝隙) + 34(星期标签列) ≈ 985px。
     到顶之后靠 margin-inline: auto 居中，而不是贴着左边留一大块空白。 */
  max-width: 990px;
  margin-inline: auto;
  /* 居中后仍要占满卡片：否则 flex 父容器会把宽度收缩成内容宽度 */
  width: 100%;
  /* 悬停浮层的定位容器 */
  position: relative;
}
.dayheat-months {
  display: grid;
  gap: var(--gap);
  /* 与 .dayheat-body 里网格的左边距对齐（星期标签列宽） */
  margin-left: 34px;
  font-size: 10.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
}
.dayheat-months span {
  overflow: hidden;
  text-overflow: clip;
}
.dayheat-body {
  display: flex;
  gap: 8px;
  /* 拉平高度：左侧星期标签列要和右侧 7 行格子等高，靠 space-between 对齐到每一行 */
  align-items: stretch;
  min-width: 0;
}
.dayheat-days {
  display: flex;
  flex-direction: column;
  /* 7 个标签等距铺满整列高度：容器高 = 7 格 + 6 缝隙时，space-between 的间距正好等于格子间距 */
  justify-content: space-between;
  width: 26px;
  flex: 0 0 auto;
  font-size: 9.5px;
  color: var(--muted);
  text-align: right;
}
.dayheat-days span {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  line-height: 1;
}
.dayheat-days span.dim {
  opacity: 0;
}
.dayheat-grid {
  display: grid;
  gap: var(--gap);
  flex: 1;
  min-width: 0;
}
.dayheat-col {
  display: grid;
  /* 行高由格子的 aspect-ratio 决定：列宽 = 行高，格子才是正方形（GitHub 那种小方块） */
  grid-template-rows: repeat(7, auto);
  gap: var(--gap);
  min-width: 0;
}
.dayheat-cell {
  aspect-ratio: 1;
  width: 100%;
  border-radius: 2.5px;
  /* 格子本身不设边框（53×7 个 1px 边框会糊成一片），悬停靠 outline */
  transition: outline-color 0.1s ease;
  outline: 1px solid transparent;
  outline-offset: 0;
}
/* 高亮态：鼠标悬停的格子和色带联动命中的格子，语义完全一样（都是「当前指向的这一格」），
 * 所以共用同一套视觉——就以原来鼠标悬停的样式为准（只换描边颜色，不放大、不加光晕）。
 * 放大/发光会改变格子的视觉尺寸，53 列网格里反而显得突兀。 */
.dayheat-cell:hover,
.dayheat-cell.linked {
  outline-color: var(--dayheat-hover, #ffb02e);
}
.dayheat-cell.future {
  outline: none;
}
/* 悬停浮层：视觉对齐月视图的 ECharts tooltip（同 tipBg/tipBorder/tipText，
 * 同样的小圆角与 11.5px 字号），这样两个视图的悬停观感一致。
 * 用绝对定位自己画而不用原生 title：title 有 ~1 秒延迟且样式不可控。 */
.dayheat-tip {
  position: absolute;
  z-index: 5;
  /* 默认在格子正上方居中；translateY(-100%) 再留 8px 间距 */
  transform: translate(-50%, -100%) translateY(-8px);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
  border-radius: 6px;
  border: 1px solid var(--dayheat-tip-border);
  background: var(--dayheat-tip-bg);
  color: var(--dayheat-tip-text);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}
.dayheat-tip b {
  font-weight: 600;
}
.dayheat-tip span {
  color: var(--dayheat-tip-muted);
}
/* 靠近右边缘时翻到格子左侧，靠近顶部时翻到下方，避免浮层被卡片裁掉 */
.dayheat-tip.flip-x {
  transform: translate(-100%, -100%) translate(4px, -8px);
}
.dayheat-tip.flip-y {
  transform: translate(-50%, 0) translateY(8px);
}
.dayheat-tip.flip-x.flip-y {
  transform: translate(-100%, 0) translate(4px, 8px);
}
.dayheat-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  /* 与月份标签左边距对齐，右端与网格右端对齐 */
  padding-left: 34px;
}
</style>
