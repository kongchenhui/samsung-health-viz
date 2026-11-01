// 图表/地图等 Canvas 绘制的配色（CSS 变量管不到 Canvas，这里按主题给一套）
import { store } from '../store.js';

export function chartColors() {
  const light = store.theme === 'light';
  return {
    axis: light ? '#5d6b7f' : '#8a99ad',
    split: light ? 'rgba(30, 50, 90, 0.1)' : 'rgba(255, 255, 255, 0.06)',
    tipBg: light ? 'rgba(255, 255, 255, 0.98)' : 'rgba(13, 19, 28, 0.96)',
    tipBorder: light ? '#dfe5ee' : '#1e2a3a',
    tipText: light ? '#1c2532' : '#e8eef7',
    tipMuted: light ? '#5d6b7f' : '#8a99ad',
    tipLabel: light ? '#3d4a5c' : '#c3cfdd',
    pointer: light ? '#a9b6c7' : '#5b6b80',
    // 日历热力：格子间隙 / 低值文字
    heatGap: light ? '#ffffff' : '#0b0f16',
    heatLowLabel: light ? '#4a586c' : '#aeb9c9',
    heatHiLabel: 'rgba(10, 14, 20, 0.8)',
    // 热力色带（天/月视图共用，连续插值，不分档）。
    // 低端不用「几乎透明的琥珀」：叠在深色卡片上会变成一块近黑的死格子，
    // 看着像被禁用而不是「骑了一点点」。改从一个能看出来的淡琥珀起步（alpha 0.22），
    // 再到中段 0.6、末端纯色——深色主题下最浅格仍带明确的暖色，浅色主题下也不发灰。
    // 数据色：明暗主题共用同一组（遵守「数据色两套主题共用」）。
    heatStops: [
      { at: 0, color: 'rgba(255, 176, 46, 0.22)' },
      { at: 0.5, color: 'rgba(255, 176, 46, 0.62)' },
      { at: 1, color: '#ffb02e' },
    ],
    heatDayEmpty: light ? 'rgba(20, 40, 80, 0.075)' : 'rgba(255, 255, 255, 0.055)',
    emphasis: light ? '#c2760a' : '#ffd27a',
    // 图表系列色：明暗主题共用同一套亮色（与深色主题一致）
    series: {
      speed: '#38bdf8',
      hr: '#f87171',
      altitude: '#2dd4bf',
      recovery: '#a78bfa',
    },
    // 地图起终点标记颜色与深色一致；border 仅决定描边在底图上的可见性
    markers: {
      start: '#22c55e',
      end: '#ef4444',
      border: light ? '#1c2532' : '#ffffff',
    },
    // 地图路线描边：深色底用近黑描边，浅色底用白描边把彩线从底图上分离出来
    routeCasing: light ? { color: '#ffffff', opacity: 0.92 } : { color: '#05080e', opacity: 0.55 },
    // 详情页「按速度着色」色阶（慢 → 快）：明暗共用
    speedStops: [
      [0, [56, 189, 248]],
      [0.35, [45, 212, 191]],
      [0.65, [250, 204, 21]],
      [1, [248, 113, 113]],
    ],
  };
}
