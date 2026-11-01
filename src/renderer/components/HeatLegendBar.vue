<script setup>
import { computed, ref } from 'vue';
import { store } from '../store.js';
import { chartColors } from '../lib/palette.js';
import { sampleGradient } from '../lib/color-scale.js';
import { kmNumber } from '../lib/format.js';
import { t } from '../lib/i18n.js';

/* 热力色带图例：日视图与月视图共用同一个组件。
 *
 * 为什么不用 ECharts 的 visualMap：它是画在 canvas 里的，圆角、滑块大小、字号都没法跟
 * 界面其它部分统一，日视图（纯 DOM）又要照着它再仿一遍，两边永远对不齐。
 * 这里用 DOM 手写一套，两个视图引用同一个组件，观感天然一致。
 *
 * 两个方向的交互都照搬 ECharts visualMap（ContinuousView.js）：
 *   A. 悬停色带 → hoverLink：光标两侧各 6px 换算成值域区间，父组件据此高亮命中的数据
 *      hoverRange = [cursorPos-6, cursorPos+6]；触到两端时边界外推成 ∓Infinity
 *      标签前缀 '< ' / '≈ ' / '> ' 与 ECharts 一致
 *   B. 悬停数据（格子）→ _hoverLinkFromSeriesMouseOver：只把指示器挪到该值的位置，
 *      标签显示精确值（无前缀），不影响其它数据
 * 组件只负责「算区间 + 画色带 + 挪指示器」，具体高亮哪些数据由父组件决定。 */
const HOVER_LINK_HALF_PX = 6; // ECharts HOVER_LINK_SIZE(12) / 2

const props = defineProps({
  // 色带末端对应的里程（米），即 calendar.js / data.js 算出的归一化上限
  maxM: { type: Number, required: true },
  // 方向：横向（默认，左少右多）/ 纵向（下少上多）
  orient: { type: String, default: 'horizontal' },
  // 外部指定的高亮值（米）：悬停格子时把指示器挪到对应位置；null 表示没有
  activeValueM: { type: Number, default: null },
});
const emit = defineEmits(['hover']);

const isVertical = computed(() => props.orient === 'vertical');

const colors = computed(() => {
  void store.theme; // 依赖主题：切换明暗后要重新取色
  return chartColors();
});
const gradient = computed(() => {
  const stops = colors.value.heatStops;
  // 纵向时「多」在上，所以渐变方向是 to top
  const dir = isVertical.value ? 'to top' : '90deg';
  return `linear-gradient(${dir}, ${stops.map((s) => `${s.color} ${(s.at * 100).toFixed(0)}%`).join(', ')})`;
});

const trackEl = ref(null);
const barHover = ref(null); // { ratio, loVal, hiVal, loInf, hiInf }

function update(event) {
  const track = trackEl.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  // 纵向色带沿 y 轴取位置，横向沿 x 轴
  const size = isVertical.value ? rect.height : rect.width;
  if (!size) return;
  const max = Number(props.maxM);
  if (!Number.isFinite(max) || max <= 0) return;
  const offset = isVertical.value ? event.clientY - rect.top : event.clientX - rect.left;
  const pos = Math.min(size, Math.max(0, offset));
  // 纵向时顶部是「多」：位置比例要反过来
  const ratio = isVertical.value ? 1 - pos / size : pos / size;
  const half = HOVER_LINK_HALF_PX / size;
  const loRatio = ratio - half;
  const hiRatio = ratio + half;
  barHover.value = {
    ratio,
    // 值域区间（米）；两端越界时用 0 / Infinity 表示无界
    loVal: Math.max(0, loRatio) * max,
    hiVal: Math.min(1, hiRatio) * max,
    loInf: loRatio < 0,
    hiInf: hiRatio > 1,
  };
  emit('hover', barHover.value);
}
function leave() {
  barHover.value = null;
  emit('hover', null);
}

/* 外部传入的高亮值（米）。注意不能直接 Number(null)——Number(null) === 0，
 * 会把「没有悬停」误判成「值为 0」，导致没交互时滑块常驻在最左端并显示 0.00。 */
const activeValue = computed(() => {
  const raw = props.activeValueM;
  if (raw == null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
});

/* 指示器位置：色带悬停优先（跟随鼠标），其次是外部传入的格子值（挪到该值所在位置）。
 * 两者都没有时返回 null → 滑块隐藏，不做无交互的常驻显示。 */
const indicatorRatio = computed(() => {
  if (barHover.value) return barHover.value.ratio;
  const v = activeValue.value;
  const max = Number(props.maxM);
  if (v != null && Number.isFinite(max) && max > 0) return Math.min(1, Math.max(0, v / max));
  return null;
});
const indicatorVisible = computed(() => indicatorRatio.value != null);
const indicatorStyle = computed(() => {
  const ratio = indicatorRatio.value ?? 0;
  const style = {
    background: indicatorVisible.value ? sampleGradient(ratio, 0, 1, colors.value.heatStops) : 'transparent',
  };
  // 纵向：ratio=1（多）在最上方，所以 top = (1-ratio)
  if (isVertical.value) style.top = `${((1 - ratio) * 100).toFixed(2)}%`;
  else style.left = `${(ratio * 100).toFixed(2)}%`;
  return style;
});

/* 标签位置：与旧版 ECharts 一致——竖向时跟着指示器的高度走（indicatorLabel 就是这么定位的），
 * 而不是钉在色带正中；横向时放在色带左侧垂直居中。 */
// 只有纵向的标签跟随指示器；横向固定在左侧不动
const valueStyle = computed(() => {
  const ratio = indicatorRatio.value ?? 0;
  return { top: `${((1 - ratio) * 100).toFixed(2)}%` };
});

/* 数值标签：
 * - 悬停色带 → 值域区间，前缀 '< ' / '≈ ' / '> '（与 ECharts 一致），不带单位
 * - 悬停格子 → 该值的精确数字，无前缀 */
const labelText = computed(() => {
  // 和 ECharts 一致取整数：它的 visualMap 默认 precision 为 null，
  // formatValueText 里 `Math.min(null, 20)` 等于 0，即 toFixed(0) —— 所以 ECharts 显示的是「= 37」而不是「= 37.00」。
  const fmt = (meters) => kmNumber(meters, 0);
  const b = barHover.value;
  if (b) {
    if (b.loInf) return `< ${fmt(b.hiVal)}`;
    if (b.hiInf) return `> ${fmt(b.loVal)}`;
    return `≈ ${fmt(b.ratio * props.maxM)}`;
  }
  const v = activeValue.value;
  if (v != null) return fmt(v);
  return '';
});
</script>

<template>
  <span class="heatlegend" :class="isVertical ? 'is-vertical' : 'is-horizontal'" aria-hidden="true">
    <!-- 横向：数值固定在色带左端外侧，不跟随鼠标（保持原来的观感） -->
    <span v-if="!isVertical && labelText" class="heatlegend-value is-fixed">{{ labelText }}</span>
    <!-- 纵向时「多」在上、「少」在下；横向时「少」在左、「多」在右 -->
    <span class="muted small heatlegend-end">{{ isVertical ? t('heatmap.more') : t('heatmap.less') }}</span>
    <span
      ref="trackEl"
      class="heatlegend-track"
      :style="{ background: gradient }"
      @mouseenter="update"
      @mousemove="update"
      @mouseleave="leave"
    >
      <!-- 纵向：数值跟着指示器走（旧版 ECharts 的 indicatorLabel 行为）。
           放在色带内部，百分比基准才是色带本身，能和指示器严格对齐。 -->
      <span v-if="isVertical && labelText" class="heatlegend-value is-follow" :style="valueStyle">{{ labelText }}</span>
      <i class="heatlegend-indicator" :class="{ visible: indicatorVisible }" :style="indicatorStyle"></i>
    </span>
    <span class="muted small heatlegend-end">{{ isVertical ? t('heatmap.less') : t('heatmap.more') }}</span>
  </span>
</template>

<style scoped>
.heatlegend {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 纵向：文字上下叠、色带竖直 */
.heatlegend.is-vertical {
  flex-direction: column;
}
/* 两端「少 / 多」标签：与 ECharts visualMap 的 textStyle 一致用 10px */
.heatlegend-end {
  font-size: 10px;
}
.heatlegend-track {
  position: relative;
  width: 78px;
  height: 10px;
  /* 胶囊形圆角（高度的一半）：这是日视图原本的样式，不要改成方角 */
  border-radius: 5px;
}
.heatlegend.is-vertical .heatlegend-track {
  width: 10px;
  height: 78px;
}
.heatlegend-indicator {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  /* 描边用卡片底色，把圆点从色带上「抠」出来；再叠一层阴影保证浅色底上边界清楚 */
  border: 2px solid var(--card, #fff);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
  opacity: 0;
  pointer-events: none;
}
/* 横向：水平居中靠 top 50% + 负 margin，纵向反之 */
.heatlegend.is-horizontal .heatlegend-indicator {
  top: 50%;
  margin-top: -7px;
  margin-left: -7px;
  transition:
    opacity 0.12s ease,
    left 0.12s ease;
}
.heatlegend.is-vertical .heatlegend-indicator {
  left: 50%;
  margin-left: -7px;
  margin-top: -7px;
  transition:
    opacity 0.12s ease,
    top 0.12s ease;
}
.heatlegend-indicator.visible {
  opacity: 1;
}
/* 「≈ / < / > 里程」标签 */
.heatlegend-value {
  position: absolute;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
/* 横向：固定在图例左端外侧、垂直居中，不随鼠标移动 */
.heatlegend-value.is-fixed {
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}
/* 纵向：跟着指示器的高度走（色带内部，top 由内联样式给出） */
.heatlegend-value.is-follow {
  right: calc(100% + 6px);
  transform: translateY(-50%);
}
</style>
