<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import { makeMap, projectPoint, createTileLayers, tileOpacity, requiresStadiaKey } from '../lib/leaflet.js';
import { showToast } from '../store.js';
import { i18n, t } from '../lib/i18n.js';
import { chartColors } from '../lib/palette.js';

const props = defineProps({
  mode: { type: String, default: 'career' }, // career | detail
  tracks: { type: Array, default: () => [] },
  segments: { type: Array, default: () => [] },
  mapStyle: { type: String, default: 'amap-dark' },
  coordSys: { type: String, default: 'wgs84' }, // 详情页当前骑行的坐标基准
  stadiaKey: { type: String, default: '' }, // Stadia Maps API Key（alidade 底图需要）
  dim: { type: Number, default: 0 }, // 底图淡化 0-100
  fit: { type: Boolean, default: true },
});
const emit = defineEmits(['pick']);

const el = ref(null);
let map = null;
let routeLayer = null; // 轨迹（含描边）
let tileBase = null;
let tileRef = null;
let ro = null;
let cssClass = '';
let tileErrorShown = false;
const fitPoints = [];

/* ---------- 全屏 ---------- */
// 全屏时把所在的地图卡片（.map-card）固定到内容区，保留自绘标题栏，
// 这样窗口的原生按钮（macOS 红绿灯 / Windows 右上角）与导航仍然可用。
const FS_CARD_CLASS = 'map-card--fs';
const FS_PANEL_CLASS = 'map-panel--fs'; // 兜底：没有 .map-card 祖先时直接全屏地图容器
const ICON_EXPAND =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
const ICON_COMPRESS =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M14 6h-4v4M2 10h4v4"/></svg>';

let fsBtn = null;
let isFullscreen = false;

let lastSize = null;
let resizeTimer = null;

/**
 * 容器尺寸变化（全屏切换 / 窗口缩放）后重新初始化视野：
 * 先 invalidateSize 让 Leaflet 重新测量，再按轨迹范围 fitBounds，避免地图停在旧视野/半空区域。
 */
function refitView() {
  if (!map) return;
  map.invalidateSize({ animate: false });
  if (props.fit && fitPoints.length) {
    map.fitBounds(L.latLngBounds(fitPoints), { padding: [26, 26] });
  }
}

function setFullscreen(on) {
  if (on === isFullscreen) return;
  const card = el.value?.closest('.map-card');
  const target = card || el.value;
  if (!target) return;

  isFullscreen = on;
  target.classList.toggle(card ? FS_CARD_CLASS : FS_PANEL_CLASS, on);
  // 全屏期间锁住页面滚动，避免背景内容跟着滚
  document.body.classList.toggle('map-fs', on);

  if (fsBtn) {
    fsBtn.innerHTML = on ? ICON_COMPRESS : ICON_EXPAND;
    fsBtn.title = on ? t('map.exitFullscreen') : t('map.fullscreen');
    fsBtn.setAttribute('aria-label', fsBtn.title);
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.classList.toggle('active', on);
  }
  // 容器尺寸变了：立即同步一次，再等布局落定后重新算一次缩放/位置
  map?.invalidateSize({ animate: false });
  requestAnimationFrame(() => refitView());
  // 全屏类名/滚动锁定的布局可能晚一帧生效，兜底再对齐一次
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refitView, 120);
}

function onKeydown(e) {
  if (isFullscreen && e.key === 'Escape') setFullscreen(false);
}

function createFullscreenControl() {
  const FullscreenControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar map-fs-control');
      fsBtn = L.DomUtil.create('button', 'map-fs-toggle', box);
      fsBtn.type = 'button';
      fsBtn.title = t('map.fullscreen');
      fsBtn.setAttribute('aria-label', t('map.fullscreen'));
      fsBtn.setAttribute('aria-pressed', 'false');
      fsBtn.innerHTML = ICON_EXPAND;
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      L.DomEvent.on(fsBtn, 'click', (e) => {
        L.DomEvent.stop(e);
        setFullscreen(!isFullscreen);
      });
      return box;
    },
  });
  return new FullscreenControl();
}

function toLatLng(p, coordSys) {
  const [lat, lon] = projectPoint(props.mapStyle, p[0], p[1], coordSys || 'wgs84');
  return [lat, lon];
}

function draw({ fit = true } = {}) {
  if (!map) return;
  const c = chartColors();
  // 路线描边跟随主题：深色底近黑描边，浅色底白色描边（避免彩色轨迹在浅底上显得脏/糊）
  const casing = {
    color: c.routeCasing.color,
    opacity: c.routeCasing.opacity,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  };
  routeLayer.clearLayers();
  fitPoints.length = 0;

  if (props.mode === 'career') {
    if (import.meta.env.DEV) {
      for (const t of props.tracks) {
        if (!t.coordSys) console.warn('[MapPanel] 轨迹缺少 coordSys，将按 wgs84 绘制，可能造成偏移:', t.id);
      }
    }
    const items = props.tracks
      .map((t) => ({ t, latlngs: t.points.map((p) => toLatLng(p, t.coordSys)) }))
      .filter((it) => it.latlngs.length > 1);

    // 1) 先画所有深色描边，让轨迹在浅色/深色底图上都清晰
    for (const it of items) {
      fitPoints.push(...it.latlngs);
      routeLayer.addLayer(
        L.polyline(it.latlngs, {
          ...casing,
          weight: (it.t.weight ?? 4) + 5,
        })
      );
    }
    // 2) 再画彩色轨迹（带 tooltip / 点击 / 起点圆点）
    for (const it of items) {
      const weight = it.t.weight ?? 4;
      const opacity = it.t.opacity ?? 0.9;
      const line = L.polyline(it.latlngs, {
        color: it.t.color,
        weight,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
      });
      if (it.t.tooltipHtml) {
        line.bindTooltip(it.t.tooltipHtml, { sticky: true, className: 'map-tip', direction: 'auto' });
      }
      line.on('mouseover', () => line.setStyle({ weight: weight + 2, opacity: 1 }));
      line.on('mouseout', () => line.setStyle({ weight, opacity }));
      line.on('click', () => emit('pick', it.t.id));
      routeLayer.addLayer(line);
      routeLayer.addLayer(
        L.circleMarker(it.latlngs[0], {
          radius: 3.8,
          color: '#05080e',
          weight: 1.2,
          fillColor: it.t.color,
          fillOpacity: 1,
          interactive: false,
        })
      );
    }
  } else {
    const all = [];
    for (const seg of props.segments) all.push(...seg.latlngs);
    // 整条轨迹的描边
    if (all.length > 1) {
      const latlngs = all.map((p) => toLatLng(p, props.coordSys));
      fitPoints.push(...latlngs);
      routeLayer.addLayer(L.polyline(latlngs, { ...casing, weight: 10 }));
    }
    // 按速度着色的分段
    for (const seg of props.segments) {
      routeLayer.addLayer(
        L.polyline(seg.latlngs.map((p) => toLatLng(p, props.coordSys)), {
          color: seg.color,
          weight: 5,
          opacity: 0.98,
          lineCap: 'round',
          lineJoin: 'round',
        })
      );
    }
    if (props.segments.length) {
      const first = props.segments[0].latlngs[0];
      const lastSeg = props.segments[props.segments.length - 1];
      const last = lastSeg.latlngs[lastSeg.latlngs.length - 1];
      // 起终点标记的描边/填充随主题变化（浅色底图上白描边会消失，改用 markers.border）
      routeLayer.addLayer(
        L.circleMarker(toLatLng(first, props.coordSys), {
          radius: 6,
          color: c.markers.border,
          weight: 2,
          fillColor: c.markers.start,
          fillOpacity: 1,
        })
      );
      routeLayer.addLayer(
        L.circleMarker(toLatLng(last, props.coordSys), {
          radius: 6,
          color: c.markers.border,
          weight: 2,
          fillColor: c.markers.end,
          fillOpacity: 1,
        })
      );
    }
  }

  if (props.fit && fit && fitPoints.length) {
    map.fitBounds(L.latLngBounds(fitPoints), { padding: [26, 26] });
  }
}

function applyDim() {
  const opacity = tileOpacity(props.dim);
  if (tileBase) tileBase.setOpacity(opacity);
  if (tileRef) tileRef.setOpacity(Math.min(1, opacity * 1.15));
}

function refreshTiles() {
  if (!map) return;
  if (tileBase) {
    map.removeLayer(tileBase);
    tileBase = null;
  }
  if (tileRef) {
    map.removeLayer(tileRef);
    tileRef = null;
  }
  tileErrorShown = false;
  const container = map.getContainer();
  if (cssClass) container.classList.remove(cssClass);

  const layers = createTileLayers(props.mapStyle, L, props.stadiaKey);
  cssClass = layers.cssClass || '';
  if (cssClass) container.classList.add(cssClass);

  if (layers.base) {
    tileBase = layers.base.addTo(map);
    // 瓦片持续失败（Key 无效 / 套餐不支持 / 断网）时提示一次，避免用户对着灰底图猜
    tileBase.on('tileerror', onTileError);
    applyDim();
  }
  if (layers.reference) {
    tileRef = layers.reference.addTo(map);
    applyDim();
  }
}

function onTileError() {
  if (tileErrorShown) return;
  tileErrorShown = true;
  const keyed = requiresStadiaKey(props.mapStyle);
  showToast(keyed ? t('toast.tileErrorKeyed') : t('toast.tileError'), 'error', 5200);
}

/* 轨迹几何指纹：只有轨迹本身变化（换数据/年份/区域/单次骑行）才重新 fitBounds。
 * 主题与语言切换也会让 tracks/segments 重新计算（年份色、tooltip 文案跟着变），
 * 那种情况只需要重绘颜色，不应重置用户当前的缩放/平移。 */
function pointKey(p) {
  return p ? `${p[0].toFixed(4)},${p[1].toFixed(4)}` : '';
}
function fitSignature() {
  if (props.mode === 'career') {
    return (
      'career:' +
      props.tracks
        .map(
          (t) =>
            `${t.id}:${t.points.length}:${t.coordSys || 'wgs84'}:${pointKey(t.points[0])}:${pointKey(t.points[t.points.length - 1])}`
        )
        .join('|')
    );
  }
  const segs = props.segments;
  const lastSeg = segs[segs.length - 1];
  const last = lastSeg?.latlngs?.[lastSeg.latlngs.length - 1];
  return `detail:${segs.length}:${segs.reduce((n, s) => n + s.latlngs.length, 0)}:${pointKey(segs[0]?.latlngs?.[0])}:${pointKey(last)}`;
}
let lastFitSig = null;

onMounted(() => {
  map = makeMap(el.value);
  routeLayer = L.layerGroup().addTo(map);
  refreshTiles();
  draw();
  lastFitSig = fitSignature();
  createFullscreenControl().addTo(map);
  window.addEventListener('keydown', onKeydown);
  const initial = el.value.getBoundingClientRect();
  lastSize = { w: initial.width, h: initial.height };
  ro = new ResizeObserver(() => {
    if (!map || !el.value) return;
    const r = el.value.getBoundingClientRect();
    if (!lastSize) {
      lastSize = { w: r.width, h: r.height };
      return;
    }
    if (Math.abs(r.width - lastSize.w) < 2 && Math.abs(r.height - lastSize.h) < 2) return;
    lastSize = { w: r.width, h: r.height };
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refitView, 140);
  });
  ro.observe(el.value);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  setFullscreen(false); // 离开页面（含全屏时点击轨迹跳转）要还原类名与滚动锁定
  ro?.disconnect();
  clearTimeout(resizeTimer);
  map?.remove();
  map = null;
  fsBtn = null;
});

watch(
  () => [props.tracks, props.segments, props.mode],
  () => {
    const sig = fitSignature();
    const geometryChanged = sig !== lastFitSig;
    lastFitSig = sig;
    draw({ fit: geometryChanged });
  }
);
watch(
  () => props.mapStyle,
  () => {
    // 底图决定坐标投影：高德瓦片是 GCJ-02，OSM/Stadia 是 WGS-84，同一条轨迹在两种底图上
    // 需要不同的偏移修正。所以换底图必须重绘轨迹，但不能重设视野（保留用户当前的缩放/平移）。
    // 轨迹几何变化由上方 watch 处理（它只在指纹变化时 fit）。
    draw({ fit: false });
    refreshTiles();
  }
);
watch(
  () => props.dim,
  () => applyDim()
);
// Stadia Key 变化（首次填写 / 更换）时重建瓦片图层
watch(
  () => props.stadiaKey,
  () => refreshTiles()
);
// 切换语言后同步全屏按钮的提示文案
watch(
  () => i18n.locale,
  () => {
    if (!fsBtn) return;
    fsBtn.title = isFullscreen ? t('map.exitFullscreen') : t('map.fullscreen');
    fsBtn.setAttribute('aria-label', fsBtn.title);
  }
);
</script>

<template>
  <div class="map-panel" ref="el"></div>
</template>
