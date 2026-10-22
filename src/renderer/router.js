// 路由（vue-router，hash 模式，适配 Electron file://）
import { createRouter, createWebHashHistory } from 'vue-router';
import CareerView from './views/CareerView.vue';
import RidesView from './views/RidesView.vue';
import RideDetailView from './views/RideDetailView.vue';
import DataView from './views/DataView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/career' },
    { path: '/career', name: 'career', component: CareerView },
    { path: '/rides', name: 'rides', component: RidesView },
    { path: '/ride/:id', name: 'ride', component: RideDetailView, props: true },
    { path: '/data', name: 'data', component: DataView },
  ],
});
