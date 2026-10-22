/**
 * 坐标基准判定模块
 *
 * 背景（修改前务必阅读）：
 *   三星健康导出包**没有**任何“坐标类型/基准”字段（全量 36,146 个 JSON 字段扫描确认），
 *   但轨迹的坐标基准随记录来源不同：
 *     - 手表（Galaxy Watch）记录 GNSS 原始坐标 → WGS-84；
 *     - 手机 App 写入的轨迹由系统定位服务/地图 SDK 给出 → GCJ-02（火星坐标）。
 *   因此只能按“数据来源特征”推断，再看底图是哪种网格做换算（换算在渲染进程，见 lib/leaflet.js）。
 *
 * 实测依据（数据包 samsunghealth_<手机号>_<导出时间>，31 条骑行，29 条有 GPS）：
 *   - 手机写入的轨迹点带 `version` 字段（internal 文件带 `source_type`），共 12 条：
 *       OnePlus PLK110 11 条 + Galaxy S23 1 条 → 全部 GCJ-02；
 *   - 手表写入的轨迹点没有 `version`/`source_type`，共 19 条（Galaxy Watch7）→ 全部 WGS-84。
 *   按来源（而不是品牌）判定后，两类轨迹在高德（GCJ-02）与 OSM（WGS-84）底图上同时贴合：
 *   1966 个采样点水面命中仅 17 / 12（均为桥、堤等真实过水点）。
 *
 * 修改指引：
 *   - 想加新的“来源特征” → 改 detectCoordSys 的判定顺序，并保留上面注释与实测数据；
 *   - 想加新的“穿戴设备识别方式” → 只改 isWearableDevice；
 *   - 想适配新的设备表字段 → 改 buildDeviceIndex。
 */

/** 坐标基准常量 */
export const COORD_SYS = Object.freeze({
  /** GPS 原始坐标（国际通用，OSM/Esri 卫星瓦片） */
  WGS84: 'wgs84',
  /** 国测局加密坐标（中国大陆地图，高德/腾讯瓦片） */
  GCJ02: 'gcj02',
});

/** device_profile.csv 中三星穿戴设备的 device_type 编码 */
export const WEARABLE_DEVICE_TYPE = '10061';

/**
 * 建立“设备 UUID → 设备信息”索引。
 *
 * @param {Array<Record<string, any>>} records com.samsung.health.device_profile.*.csv 的记录数组
 * @returns {Map<string, { type: string, name: string, model: string }>}
 */
export function buildDeviceIndex(records) {
  const index = new Map();
  for (const rec of records || []) {
    if (!rec) continue;
    const uuid = String(rec.deviceuuid || '').trim();
    if (!uuid) continue;
    index.set(uuid, {
      type: String(rec.device_type || ''),
      name: rec.name || '',
      model: rec.model || '',
    });
  }
  return index;
}

/**
 * 判断设备是否为可穿戴设备（手表/手环）。
 *
 * 规则（任一命中即为穿戴设备）：
 *   1) device_type === '10061'（三星穿戴设备编码）；
 *   2) name 含 watch / band；
 *   3) model 以 SM-L 开头（Galaxy Watch 的型号段，如 SM-L310）。
 *
 * @param {{ type?: string, name?: string, model?: string } | undefined} device
 * @returns {boolean}
 */
export function isWearableDevice(device) {
  if (!device) return false;
  if (device.type === WEARABLE_DEVICE_TYPE) return true;
  if (/watch|band/i.test(device.name || '')) return true;
  if (/^SM-L/i.test(device.model || '')) return true;
  return false;
}

/**
 * 判定一条骑行轨迹的坐标基准。
 *
 * 判定顺序（顺序本身就是结论，改动需重新做水面命中校验）：
 *   1) 【优先】轨迹点格式：手机 App 写入的点带 `version` 字段 → GCJ-02；
 *   2) 【回退】按设备类型：穿戴设备（手表）→ WGS-84；其余（手机）→ GCJ-02。
 *
 * 为什么优先看点格式：它是数据本身携带的来源指纹，比设备表更直接；
 * 例如 Galaxy S23 手机那条骑行（device_profile 里是三星手机）也带 version，实际是 GCJ-02，
 * 说明“按品牌/机型猜”会判错，必须按来源格式判。
 *
 * @param {{ type?: string, name?: string, model?: string } | undefined} device
 *   该骑行对应设备（device_profile 索引中的条目，可为 undefined）
 * @param {Array<{ version?: number }> | null | undefined} locationPoints
 *   轨迹点数组（location_data.json 的原始内容，可为空）
 * @returns {'wgs84' | 'gcj02'}
 */
export function detectCoordSys(device, locationPoints) {
  const points = Array.isArray(locationPoints) ? locationPoints : [];
  const hasVersion = points.some((p) => p && p.version !== undefined);
  if (hasVersion) return COORD_SYS.GCJ02;
  return isWearableDevice(device) ? COORD_SYS.WGS84 : COORD_SYS.GCJ02;
}
