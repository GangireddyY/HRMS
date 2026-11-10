import type { RouteRecordRaw } from 'vue-router';

const feature = 'exit' as const;
const handlers = { permissions: ['exit.view', 'exit.approve', 'exit.manage', 'exit.clearance.manage', 'payroll.settlement.manage'], scope: 'TEAM' as const, feature };

/** HR operations (/hr): exits, clearance, full & final settlements, letters and alumni. */
export const exitHrRoutes: RouteRecordRaw[] = [
  { path: 'exits', name: 'hr-exits', component: () => import('./pages/ExitsPage.vue'), meta: { title: 'Exits', access: handlers } },
  { path: 'exits/settlements', name: 'hr-settlement-payouts', component: () => import('./pages/SettlementPayoutsPage.vue'), meta: { title: 'Settlement payouts', access: { permissions: ['payroll.settlement.manage'], feature } } },
  { path: 'exits/:id', name: 'hr-exit', component: () => import('./pages/ExitCasePage.vue'), meta: { title: 'Exit', access: handlers } },
  { path: 'exits/:id/letters/:letterId', name: 'hr-exit-letter', component: () => import('./pages/ExitLetterPage.vue'), meta: { title: 'Letter', access: { permissions: ['exit.manage'], feature } } },
  { path: 'alumni', name: 'hr-alumni', component: () => import('./pages/AlumniPage.vue'), meta: { title: 'Alumni', access: { permissions: ['exit.manage', 'exit.view'], scope: 'TEAM', feature } } },
];

/** My Workspace (/me): resignation, my exit and my letters. */
export const exitSelfRoutes: RouteRecordRaw[] = [
  { path: 'exit', name: 'me-exit', component: () => import('./pages/MyExitPage.vue'), meta: { title: 'Resignation & exit', access: { permissions: ['exit.resign'], feature } } },
  { path: 'exit/:id/letters/:letterId', name: 'me-exit-letter', component: () => import('./pages/ExitLetterPage.vue'), meta: { title: 'Letter', access: { permissions: ['exit.resign'], feature } } },
];
