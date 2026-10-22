// 底图与坐标系工具（数据为 WGS-84；高德瓦片为 GCJ-02，需要纠偏）
import L from 'leaflet';

export const TILES = {
  amap: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    options: { subdomains: '1234', maxZoom: 18, attribution: '© 高德地图' },
    gcj: true,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics' },
    gcj: false,
  },
  plain: { url: null, options: {}, gcj: false },
};

export const MAP_STYLE_OPTIONS = [
  { value: 'amap', label: '高德地图（中文）' },
  { value: 'satellite', label: '卫星影像' },
  { value: 'plain', label: '无底图（离线）' },
];

const PI = Math.PI;
const AA = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat, lon) {
  return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS-84 → GCJ-02（中国大陆内有效） */
export function wgs2gcj(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AA * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((AA / sqrtMagic) * Math.cos(radLat) * PI);
  return [lat + dLat, lon + dLon];
}

export function makeMap(el) {
  const map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 90,
  });
  map.attributionControl.setPrefix(false);
  return map;
}

export function applyTiles(map, style) {
  const conf = TILES[style] || TILES.plain;
  if (map._tileLayer) {
    map.removeLayer(map._tileLayer);
    map._tileLayer = null;
  }
  if (conf.url) {
    map._tileLayer = L.tileLayer(conf.url, conf.options).addTo(map);
  }
}

export function projectPoint(style, lat, lon) {
  const conf = TILES[style] || TILES.plain;
  return conf.gcj ? wgs2gcj(lat, lon) : [lat, lon];
}

export function speedColor(v, p5, p95) {
  // 速度色阶：慢 → 快
  const t = Math.max(0, Math.min(1, (v - p5) / Math.max(0.001, p95 - p5)));
  const stops = [
    [0, [56, 189, 248]],
    [0.35, [45, 212, 191]],
    [0.65, [250, 204, 21]],
    [1, [248, 113, 113]],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
