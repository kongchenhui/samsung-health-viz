// 底图主题与地图工具
//
// 坐标说明（重要，按底图分别处理）：
// 三星健康导出的 GPS 是 WGS-84。
//  - 高德栅格瓦片（矢量/卫星）：瓦片是 GCJ-02 网格，需要 WGS→GCJ 纠偏（实测同一瓦片与 OSM 相比，
//    水岸线整体偏移约 425m 东 / 237m 南，正是 GCJ 偏移量）；
//  - Esri 卫星影像、OSM：WGS-84 网格，直接叠加，不做纠偏（实测 Esri 画布与 OSM 同瓦片偏移 < 40m）。
// 调试：URL 加 ?proj=raw / ?proj=gcj 可强制指定投影方式。
import L from 'leaflet';

const AMAP_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
const AMAP_OPTS = { subdomains: '1234', maxZoom: 18, attribution: '© 高德地图' };

const ARCGIS = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const SATELLITE = `${ARCGIS}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;

export const TILES = {
  // 高德暗色：复用高德瓦片 + CSS 反色滤镜压暗，保留中文地名，彩色轨迹更突出
  'amap-dark': {
    url: AMAP_URL,
    options: AMAP_OPTS,
    cssClass: 'tiles-invert',
    gcj: true,
    attribution: '© 高德地图',
  },
  amap: {
    url: AMAP_URL,
    options: AMAP_OPTS,
    gcj: true,
    attribution: '© 高德地图',
  },
  // 高德卫星 + 中文标注
  'amap-sat': {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    options: { subdomains: '1234', maxZoom: 18, attribution: '© 高德地图' },
    reference: {
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
      options: { subdomains: '1234', maxZoom: 18 },
    },
    gcj: true,
    attribution: '© 高德地图',
  },
  satellite: {
    url: SATELLITE,
    options: { maxZoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics' },
    attribution: '© Esri',
  },
  osm: {
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' },
    attribution: '© OpenStreetMap contributors',
  },
  plain: { url: null, options: {}, attribution: '' },
};

export const MAP_STYLE_OPTIONS = [
  { value: 'amap-dark', label: '高德 · 暗色（推荐）' },
  { value: 'amap', label: '高德 · 标准' },
  { value: 'amap-sat', label: '高德 · 卫星（中文标注）' },
  { value: 'satellite', label: '卫星影像' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'plain', label: '无底图（离线）' },
];

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

/** WGS-84 → GCJ-02 */
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

/** GCJ-02 → WGS-84（迭代反算，误差 < 1m） */
export function gcj2wgs(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 3; i++) {
    const [gLat, gLon] = wgs2gcj(wgsLat, wgsLon);
    wgsLat -= gLat - lat;
    wgsLon -= gLon - lon;
  }
  return [wgsLat, wgsLon];
}

/**
 * 底图是否使用 GCJ-02 网格。
 * 目前只有高德三个主题（暗色 / 标准 / 卫星）标记了 gcj: true；
 * Esri 卫星、OSM、无底图都是 WGS-84 Web Mercator 网格。
 *
 * @param {string} style 底图主题名
 * @returns {boolean}
 */
export function basemapIsGcj(style) {
  const conf = TILES[style] || TILES.plain;
  return !!conf.gcj;
}

/**
 * 投影：把轨迹坐标换算到底图坐标系。
 *
 * 换算矩阵（轨迹基准由 core/coord-sys.mjs 的 detectCoordSys 判定）：
 *   | 轨迹 coordSys | 底图 GCJ-02（高德） | 底图 WGS-84（OSM/卫星） |
 *   |---------------|---------------------|--------------------------|
 *   | wgs84（手表）  | wgs2gcj 纠偏         | 直通                     |
 *   | gcj02（手机）  | 直通                 | gcj2wgs 反算             |
 *
 * 调试：URL 加 ?proj=raw 强制直通；?proj=gcj 强制 WGS→GCJ。
 *
 * @param {string} style 底图主题名
 * @param {number} lat
 * @param {number} lon
 * @param {'wgs84'|'gcj02'} coordSys 轨迹坐标基准（来自 core/coord-sys.mjs）
 * @returns {[number, number]}
 */
export function projectPoint(style, lat, lon, coordSys = 'wgs84') {
  let mode = null;
  try {
    mode = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('proj') : null;
  } catch {
    mode = null;
  }
  if (mode === 'raw') return [lat, lon];
  if (mode === 'gcj') return wgs2gcj(lat, lon);

  const isGcjData = coordSys === 'gcj02';
  if (basemapIsGcj(style)) return isGcjData ? [lat, lon] : wgs2gcj(lat, lon);
  return isGcjData ? gcj2wgs(lat, lon) : [lat, lon];
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
  let a = stops[0];
  let b = stops[stops.length - 1];
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

/** 按主题创建底图图层（含可选的标注参考层），返回 { base, reference, cssClass } */
export function createTileLayers(style, L) {
  const conf = TILES[style] || TILES.plain;
  const base = conf.url ? L.tileLayer(conf.url, conf.options) : null;
  const reference = conf.reference ? L.tileLayer(conf.reference.url, conf.reference.options) : null;
  return { base, reference, cssClass: conf.cssClass || '', attribution: conf.attribution || '' };
}

/** 底图淡化：0 不淡化，100 最淡（保留最小可辨识度） */
export function tileOpacity(dimPercent) {
  const d = Math.max(0, Math.min(100, Number(dimPercent) || 0));
  return 1 - (d / 100) * 0.82;
}
