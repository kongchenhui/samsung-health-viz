// 城市坐标：src/renderer/data/cities/<国家代码>.json，一个国家一个文件（加国家 = 加一个 JSON）。
// 数据只用于把轨迹聚集区「就近」匹配成地名（80km 内），不参与地图渲染。
//   文件格式：{ country: { code, names }, coordSys, cities: [{ names: { zh, en }, lat, lon }] }
//   names 按语言代码存；缺失的语言回退中文，再回退英文。
import { i18n } from './i18n.js';

const files = import.meta.glob('../data/cities/*.json', { eager: true, import: 'default' });

/** 扁平化的城市列表（启动时构建一次；~400 条，线性匹配开销可忽略） */
const CITIES = [];
for (const [path, data] of Object.entries(files)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -'.json'.length).toUpperCase();
  for (const city of data.cities || []) {
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) continue;
    CITIES.push({ country: code, names: city.names || {}, lat: city.lat, lon: city.lon });
  }
}

const EARTH_RADIUS_KM = 6371;

/** 两点球面距离（km） */
export function distKm(a, b) {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * 找离 (lat, lon) 最近的城市。
 * @param {number} lat
 * @param {number} lon
 * @param {number} [maxKm] 超过这个距离视为没有匹配（默认 80km，避免把荒野硬套成远处城市）
 * @returns {{ country: string, names: Record<string,string>, lat: number, lon: number } | null}
 */
export function nearestCity(lat, lon, maxKm = 80) {
  let best = null;
  for (const city of CITIES) {
    const d = distKm([lat, lon], [city.lat, city.lon]);
    if (!best || d < best.d) best = { city, d };
  }
  return best && best.d < maxKm ? best.city : null;
}

/**
 * 就近城市名（按当前语言）。
 * @returns {string | null} 没有匹配时返回 null（调用方用「区域 N」兜底）
 */
export function cityName(lat, lon, maxKm = 80) {
  const city = nearestCity(lat, lon, maxKm);
  if (!city) return null;
  return city.names[i18n.locale] || city.names.zh || city.names.en || null;
}
