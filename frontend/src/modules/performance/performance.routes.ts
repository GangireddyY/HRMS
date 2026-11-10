import type { RouteRecordRaw } from 'vue-router';

const feature = 'performance' as const;
const cycles = { permissions: ['performance.configure', 'performance.view'], scope: 'TEAM' as const, feature };
const reviews = { permissions: ['performance.review', 'performance.view', 'performance.configure'], scope: 'TEAM' as const, feature };
const hikes = { permissions: ['performance.review', 'performance.configure', 'employee.salary.revise'], scope: 'TEAM' as const, feature };
const pips = { permissions: ['performance.pip.manage'], scope: 'TEAM' as const, feature };
const calibration = { permissions: ['performance.configure'], feature };
const okrs = { permissions: ['performance.okr.manage'], scope: 'TEAM' as const, feature };

/** HR operations (/hr): review cycles, reviews to conduct or follow, improvement plans. */
export const performanceHrRoutes: RouteRecordRaw[] = [
  { path: 'performance/reviews', name: 'hr-reviews', component: () => import('./pages/ReviewsPage.vue'), meta: { title: 'Reviews', access: reviews } },
  { path: 'performance/reviews/:id', name: 'hr-review', component: () => import('./pages/ReviewPage.vue'), meta: { title: 'Review', access: reviews } },
  { path: 'performance/cycles', name: 'hr-cycles', component: () => import('./pages/CyclesPage.vue'), meta: { title: 'Review cycles', access: cycles } },
  { path: 'performance/cycles/:id', name: 'hr-cycle', component: () => import('./pages/CyclePage.vue'), meta: { title: 'Review cycle', access: cycles } },
  { path: 'performance/cycles/:id/hikes', name: 'hr-cycle-hikes', component: () => import('./pages/HikesPage.vue'), meta: { title: 'Salary increases', access: hikes } },
  { path: 'performance/cycles/:id/calibration', name: 'hr-cycle-calibration', component: () => import('./pages/CalibrationPage.vue'), meta: { title: 'Calibration', access: calibration } },
  { path: 'performance/okrs', name: 'hr-okrs', component: () => import('./pages/OkrsPage.vue'), meta: { title: 'OKRs', access: okrs } },
  { path: 'performance/pips', name: 'hr-pips', component: () => import('./pages/PipsPage.vue'), meta: { title: 'Improvement plans', access: pips } },
  { path: 'performance/pips/:id', name: 'hr-pip', component: () => import('./pages/PipPage.vue'), meta: { title: 'Improvement plan', access: pips } },
];

/** My Workspace (/me): own reviews, feedback requests and improvement plans (access is decided per record by the API). */
export const performanceSelfRoutes: RouteRecordRaw[] = [
  { path: 'performance', name: 'me-performance', component: () => import('./pages/MyPerformancePage.vue'), meta: { title: 'Performance', access: { tenant: true, feature } } },
  { path: 'performance/reviews/:id', name: 'me-review', component: () => import('./pages/ReviewPage.vue'), meta: { title: 'My review', access: { tenant: true, feature } } },
  { path: 'performance/pips/:id', name: 'me-pip', component: () => import('./pages/PipPage.vue'), meta: { title: 'Improvement plan', access: { tenant: true, feature } } },
  { path: 'performance/okrs', name: 'me-okrs', component: () => import('./pages/OkrsPage.vue'), meta: { title: 'OKRs', access: { tenant: true, feature } } },
  { path: 'performance/one-on-ones', name: 'me-one-on-ones', component: () => import('./pages/OneOnOnesPage.vue'), meta: { title: '1:1s', access: { tenant: true, feature } } },
  { path: 'performance/one-on-ones/:id', name: 'me-one-on-one', component: () => import('./pages/OneOnOnePage.vue'), meta: { title: '1:1', access: { tenant: true, feature } } },
];
