<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import { makeMap, projectPoint, createTileLayers, tileOpacity, requiresStadiaKey } from '../lib/leaflet.js';
import { showToast } from '../store.js';

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
    fsBtn.title = on ? '退出全屏（Esc）' : '全屏查看';
    fsBtn.setAttribute('aria-label', fsBtn.title);
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.classList.toggle('active', on);
  }
  // 容器尺寸变了：立即同步一次，再等下一帧布局落定后补一次
  map?.invalidateSize({ animate: false });
  requestAnimationFrame(() => map?.invalidateSize({ animate: false }));
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
      fsBtn.title = '全屏查看';
      fsBtn.setAttribute('aria-label', '全屏查看');
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

const CASING = { color: '#05080e', opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false };

function draw() {
  if (!map) return;
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
          ...CASING,
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
      routeLayer.addLayer(L.polyline(latlngs, { ...CASING, weight: 10, opacity: 0.5 }));
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
      routeLayer.addLayer(
        L.circleMarker(toLatLng(first, props.coordSys), { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 })
      );
      routeLayer.addLayer(
        L.circleMarker(toLatLng(last, props.coordSys), { radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 })
      );
    }
  }

  if (props.fit && fitPoints.length) {
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
  showToast(
    keyed
      ? '底图加载失败：请检查 Stadia API Key 是否有效，或套餐/额度是否支持该底图'
      : '底图加载失败，请检查网络或稍后重试',
    'error',
    5200
  );
}

onMounted(() => {
  map = makeMap(el.value);
  routeLayer = L.layerGroup().addTo(map);
  refreshTiles();
  draw();
  createFullscreenControl().addTo(map);
  window.addEventListener('keydown', onKeydown);
  ro = new ResizeObserver(() => map && map.invalidateSize());
  ro.observe(el.value);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  setFullscreen(false); // 离开页面（含全屏时点击轨迹跳转）要还原类名与滚动锁定
  ro?.disconnect();
  map?.remove();
  map = null;
  fsBtn = null;
});

watch(
  () => [props.tracks, props.segments, props.mode],
  () => draw()
);
watch(
  () => props.mapStyle,
  () => {
    // 底图切换后重建瓦片图层（坐标均为 WGS-84，轨迹无需重投影）
    draw();
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
</script>

<template>
  <div class="map-panel" ref="el"></div>
</template>
