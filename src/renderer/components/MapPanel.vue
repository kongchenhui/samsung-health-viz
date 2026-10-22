<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import { makeMap, projectPoint, createTileLayers, tileOpacity } from '../lib/leaflet.js';

const props = defineProps({
  mode: { type: String, default: 'career' }, // career | detail
  tracks: { type: Array, default: () => [] },
  segments: { type: Array, default: () => [] },
  mapStyle: { type: String, default: 'amap-dark' },
  coordSys: { type: String, default: 'wgs84' }, // 详情页当前骑行的坐标基准
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
const fitPoints = [];

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
  const container = map.getContainer();
  if (cssClass) container.classList.remove(cssClass);

  const layers = createTileLayers(props.mapStyle, L);
  cssClass = layers.cssClass || '';
  if (cssClass) container.classList.add(cssClass);

  if (layers.base) {
    tileBase = layers.base.addTo(map);
    applyDim();
  }
  if (layers.reference) {
    tileRef = layers.reference.addTo(map);
    applyDim();
  }
}

onMounted(() => {
  map = makeMap(el.value);
  routeLayer = L.layerGroup().addTo(map);
  refreshTiles();
  draw();
  ro = new ResizeObserver(() => map && map.invalidateSize());
  ro.observe(el.value);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  map?.remove();
  map = null;
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
</script>

<template>
  <div class="map-panel" ref="el"></div>
</template>
