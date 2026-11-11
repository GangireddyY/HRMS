import type { RouteRecordRaw } from 'vue-router';

const access = { permissions: ['reports.view', 'reports.payroll.view', 'reports.recruitment.view'], scope: 'TEAM' as const, feature: 'reports' as const };

/** HR operations (/hr): reports. Each report checks its own permission. */
export const reportsHrRoutes: RouteRecordRaw[] = [
  { path: 'reports', name: 'hr-reports', component: () => import('./pages/ReportsPage.vue'), meta: { title: 'Reports', access } },
  { path: 'reports/builder', name: 'hr-report-builder', component: () => import('./pages/ReportBuilderPage.vue'), meta: { title: 'Report builder', access: { permissions: ['reports.view'], scope: 'TEAM', feature: 'reports' } } },
  { path: 'reports/:key', name: 'hr-report', component: () => import('./pages/ReportPage.vue'), meta: { title: 'Report', access } },
];
