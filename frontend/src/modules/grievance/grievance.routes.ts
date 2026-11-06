import type { RouteRecordRaw } from 'vue-router';

const feature = 'grievance' as const;
const handlers = { permissions: ['grievance.view', 'grievance.manage', 'grievance.posh.access'], feature };

/** HR operations (/hr): grievance cases and the POSH annual report. */
export const grievanceHrRoutes: RouteRecordRaw[] = [
  { path: 'grievances', name: 'hr-grievances', component: () => import('./pages/GrievanceCasesPage.vue'), meta: { title: 'Grievances', access: handlers } },
  { path: 'grievances/posh-report', name: 'hr-posh-report', component: () => import('./pages/PoshReportPage.vue'), meta: { title: 'POSH annual report', access: { permissions: ['grievance.posh.access'], feature } } },
  { path: 'grievances/:id', name: 'hr-grievance', component: () => import('./pages/GrievanceCasePage.vue'), meta: { title: 'Grievance', access: handlers } },
];

/** My Workspace (/me): raise and follow your own grievances. */
export const grievanceSelfRoutes: RouteRecordRaw[] = [
  { path: 'grievances', name: 'me-grievances', component: () => import('./pages/MyGrievancesPage.vue'), meta: { title: 'Grievances', access: { permissions: ['grievance.submit'], feature } } },
  { path: 'grievances/:id', name: 'me-grievance', component: () => import('./pages/MyGrievancePage.vue'), meta: { title: 'Grievance', access: { permissions: ['grievance.submit'], feature } } },
];
