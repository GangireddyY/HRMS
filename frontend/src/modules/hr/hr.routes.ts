import type { RouteRecordRaw } from 'vue-router';

/** HR operations workspace (/hr). */
export const hrRoutes: RouteRecordRaw[] = [
  { path: '', name: 'hr-dashboard', component: () => import('./pages/HrDashboardPage.vue'), meta: { title: 'HR dashboard' } },
];
