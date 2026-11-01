// 连续色阶：把一个数值按区间映射成颜色（无极调，不分档）
//
// 为什么需要这个：日历热力原来的做法是「分档取色」——把里程切成 4 档，每档一个固定色。
// 档位边界一旦和数据分布绑定（分位数切档），20km 和 60km 就会落进同一档显示成同一个颜色；
// 即便改成固定里程刻度，肉眼也只能看出 4 级台阶。这里换成连续插值：
// 给定数值和范围，直接在色带上按比例取色，任意两个不同的值都能得到不同的颜色。
//
// 这个模块是纯函数（无 vue / DOM / i18n 依赖），方便单独验证。

/** '#rgb' / '#rrggbb' / 'rgba(r,g,b,a)' / 'rgb(r,g,b)' → { r, g, b, a }；解析失败返回 null */
export function parseColor(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  // 十六进制
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  // rgb() / rgba()：分隔符允许逗号和空格
  const fn = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,\/]\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) {
    const a = fn[4] === undefined ? 1 : Number(fn[4]);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: Number.isFinite(a) ? a : 1 };
  }
  return null;
}

/** 已解析的颜色对象或颜色字符串统一成 { r, g, b, a }；失败返回 null */
function asColor(input) {
  if (input && typeof input === 'object' && Number.isFinite(input.r)) {
    return { r: input.r, g: input.g, b: input.b, a: Number.isFinite(input.a) ? input.a : 1 };
  }
  return parseColor(input);
}

/** 颜色 → '#rrggbb'（丢弃 alpha）；用于必须输出纯 hex 的场景（如 ECharts 色条） */
export function toHex(color) {
  const c = asColor(color);
  if (!c) return '#000000';
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** 颜色 → 'rgba(r,g,b,a)'，alpha 保留三位小数 */
export function toRgba(color) {
  const c = asColor(color);
  if (!c) return 'rgba(0, 0, 0, 1)';
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Number(c.a.toFixed(3))})`;
}

/**
 * 两个颜色之间线性插值（含 alpha，所以半透明的起止色也能平滑过渡）。
 * @param {string} from 任意受支持的颜色格式
 * @param {string} to 任意受支持的颜色格式
 * @param {number} t 0 = from，1 = to（自动夹到 [0,1]）
 * @returns {string} 'rgba(...)'；两端都不含 alpha 时返回 '#rrggbb'
 */
export function mixColor(from, to, t) {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return from;
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  const mixed = {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: a.a + (b.a - a.a) * k,
  };
  // 不透明的一律给 hex（更短、日志更好读），半透明的才用 rgba
  return mixed.a >= 0.999 ? toHex(mixed) : toRgba(mixed);
}

/**
 * 按停靠点（stop）组成的色带取色。
 *
 * @param {number} value 要映射的数值
 * @param {number} min 区间下界（value <= min 返回第一个颜色）
 * @param {number} max 区间上界（value >= max 返回最后一个颜色）
 * @param {Array<{at:number, color:string}>} stops 停靠点，at 为 0-1 的相对位置，需按 at 升序
 * @returns {string} '#rrggbb'
 *
 * 为什么用停靠点而不是「两色线性插值」：琥珀色从极淡到饱和如果只看 RGB 直线插值，
 * 中间会发灰发浑（低明度段不饱和）。多给一个中间停靠点就能让过渡段保持干净的琥珀色相。
 */
export function sampleGradient(value, min, max, stops) {
  if (!Array.isArray(stops) || stops.length === 0) return '#000000';
  const lo = Number(min);
  const hi = Number(max);
  const v = Number(value);
  // 区间退化（min === max）或非法输入：一律返回最先的颜色，避免 NaN 传播成透明/黑色
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return stops[0].color;
  }
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  if (stops.length === 1) return stops[0].color;

  // 找到 t 落在的两个停靠点之间
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b.at) {
      const span = b.at - a.at;
      // 相邻停靠点 at 相同（配置写重了）时不除零，直接取后者
      const k = span > 0 ? (t - a.at) / span : 1;
      return mixColor(a.color, b.color, k);
    }
  }
  return stops[stops.length - 1].color;
}
