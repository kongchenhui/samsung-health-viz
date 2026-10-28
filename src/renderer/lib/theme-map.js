// 主题与底图的「成对」映射（纯数据 + 纯函数，与 DOM/Electron 无关，便于单独验证）
//
// 只有成对存在的底图才联动：高德暗/标准、Alidade 暗/亮。
// 卫星、OSM、Stamen 没有对应物，保持用户选择不动。
export const THEME_STYLE_SWAP = {
  light: { 'amap-dark': 'amap', 'alidade-smooth-dark': 'alidade-smooth' },
  dark: { amap: 'amap-dark', 'alidade-smooth': 'alidade-smooth-dark' },
};

/**
 * 给定生效主题与当前底图，算出应该换成的底图。
 * @param {'dark'|'light'} theme
 * @param {string} mapStyle
 * @returns {string|null} 需要切换的目标底图；已配套或没有对应物时返回 null
 */
export function pairedStyleFor(theme, mapStyle) {
  return THEME_STYLE_SWAP[theme]?.[mapStyle] || null;
}
