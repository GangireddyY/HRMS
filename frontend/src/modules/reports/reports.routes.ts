import type { RouteRecordRaw } from 'vue-router';

const access = { permissions: ['reports.view', 'reports.payroll.view', 'reports.recruitment.view'], scope: 'TEAM' as const, feature: 'reports' as const };

/** HR operations (/hr): reports. Each report checks its own permission. */
export const reportsHrRoutes: RouteRecordRaw[] = [
  { path: 'reports', name: 'hr-reports', component: () => import('./pages/ReportsPage.vue'), meta: { title: 'Reports', access } },
  { path: 'reports/:key', name: 'hr-report', component: () => import('./pages/ReportPage.vue'), meta: { title: 'Report', access } },
];
