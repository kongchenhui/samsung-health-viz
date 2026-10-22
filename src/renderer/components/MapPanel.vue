<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import { makeMap, applyTiles, projectPoint } from '../lib/leaflet.js';

const props = defineProps({
  mode: { type: String, default: 'career' }, // career | detail
  tracks: { type: Array, default: () => [] },
  segments: { type: Array, default: () => [] },
  mapStyle: { type: String, default: 'amap' },
  fit: { type: Boolean, default: true },
});
const emit = defineEmits(['pick']);

const el = ref(null);
let map = null;
let layer = null;
let ro = null;
const fitPoints = [];

function toLatLng(p) {
  const [lat, lon] = projectPoint(props.mapStyle, p[0], p[1]);
  return [lat, lon];
}

function draw() {
  if (!map) return;
  layer.clearLayers();
  fitPoints.length = 0;

  if (props.mode === 'career') {
    for (const t of props.tracks) {
      const latlngs = t.points.map(toLatLng);
      fitPoints.push(...latlngs);
      const weight = t.weight ?? 3.5;
      const opacity = t.opacity ?? 0.62;
      const line = L.polyline(latlngs, {
        color: t.color,
        weight,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
      });
      if (t.tooltipHtml) {
        line.bindTooltip(t.tooltipHtml, { sticky: true, className: 'map-tip', direction: 'auto' });
      }
      line.on('mouseover', () => line.setStyle({ weight: weight + 2, opacity: 1 }));
      line.on('mouseout', () => line.setStyle({ weight, opacity }));
      line.on('click', () => emit('pick', t.id));
      layer.addLayer(line);
      if (latlngs.length) {
        layer.addLayer(
          L.circleMarker(latlngs[0], {
            radius: 3.5,
            color: '#0b0f16',
            weight: 1,
            fillColor: t.color,
            fillOpacity: 0.95,
            interactive: false,
          })
        );
      }
    }
  } else {
    for (const seg of props.segments) {
      const latlngs = seg.latlngs.map(toLatLng);
      fitPoints.push(...latlngs);
      layer.addLayer(
        L.polyline(latlngs, { color: seg.color, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' })
      );
    }
    if (props.segments.length) {
      const first = props.segments[0].latlngs[0];
      const lastSeg = props.segments[props.segments.length - 1];
      const last = lastSeg.latlngs[lastSeg.latlngs.length - 1];
      layer.addLayer(
        L.circleMarker(toLatLng(first), { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 })
      );
      layer.addLayer(
        L.circleMarker(toLatLng(last), { radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 })
      );
    }
  }

  if (props.fit && fitPoints.length) {
    map.fitBounds(L.latLngBounds(fitPoints), { padding: [26, 26] });
  }
}

function refreshTiles() {
  if (map) applyTiles(map, props.mapStyle);
}

onMounted(() => {
  map = makeMap(el.value);
  layer = L.layerGroup().addTo(map);
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
  () => [props.tracks, props.segments],
  () => draw()
);
watch(
  () => props.mapStyle,
  () => {
    refreshTiles();
    draw();
  }
);
</script>

<template>
  <div class="map-panel" ref="el"></div>
</template>
