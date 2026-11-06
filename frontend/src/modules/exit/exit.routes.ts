import type { RouteRecordRaw } from 'vue-router';

const feature = 'exit' as const;
const handlers = { permissions: ['exit.view', 'exit.approve', 'exit.manage', 'exit.clearance.manage', 'payroll.settlement.manage'], scope: 'TEAM' as const, feature };

/** HR operations (/hr): exits, clearance and full & final settlements. */
export const exitHrRoutes: RouteRecordRaw[] = [
  { path: 'exits', name: 'hr-exits', component: () => import('./pages/ExitsPage.vue'), meta: { title: 'Exits', access: handlers } },
  { path: 'exits/:id', name: 'hr-exit', component: () => import('./pages/ExitCasePage.vue'), meta: { title: 'Exit', access: handlers } },
];

/** My Workspace (/me): resignation and my exit. */
export const exitSelfRoutes: RouteRecordRaw[] = [
  { path: 'exit', name: 'me-exit', component: () => import('./pages/MyExitPage.vue'), meta: { title: 'Resignation & exit', access: { permissions: ['exit.resign'], feature } } },
];
