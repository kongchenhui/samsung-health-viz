// 路由（vue-router，hash 模式，适配 Electron file://）
import { createRouter, createWebHashHistory } from 'vue-router';
import CareerView from './views/CareerView.vue';
import RidesView from './views/RidesView.vue';
import RideDetailView from './views/RideDetailView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/career' },
    { path: '/career', name: 'career', component: CareerView },
    { path: '/rides', name: 'rides', component: RidesView },
    { path: '/ride/:id', name: 'ride', component: RideDetailView, props: true },
    // 设置页（数据包 / 外观 / 语言 / 底图偏好）；保留 /data 别名兼容旧深链
    { path: '/settings', name: 'settings', component: SettingsView, alias: ['/data'] },
  ],
});

// 设置窗口的唯一入口：所有跳转设置页的地方（标题栏齿轮、欢迎页入口、深链、调试参数等）
// 统一 push 到 /settings，由这里判断当前是不是设置窗口：
//   - 设置窗口自身（window.api.windowKind === 'settings'）→ 放行，渲染设置页；
//   - 主窗口 → 交给主进程打开独立的设置窗口，并取消/回落主窗口内的导航。
// 组件里不要再直接调用 window.api.openSettings()，统一走这一层，避免漏掉某个入口。
router.beforeEach((to, from) => {
  if (to.name !== 'settings') return true;
  if (window.api?.windowKind === 'settings') return true;
  if (window.api?.openSettings) {
    // 支持 /settings?tab=map|data|about 直达分栏
    const tab = typeof to.query?.tab === 'string' ? to.query.tab : undefined;
    window.api.openSettings(tab);
    // 已有当前页面时取消本次导航；冷启动深链（还没有 from）则回落到生涯页，
    // 否则首次导航被取消会留下空白主窗口。
    return from.name ? false : { name: 'career' };
  }
  // 非 Electron 环境（浏览器预览）没有独立窗口能力，允许直接渲染设置页兜底
  return true;
});
