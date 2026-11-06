import type { RouteRecordRaw } from 'vue-router';

const feature = 'compliance' as const;
const manage = { permissions: ['compliance.manage'], feature };

/** HR operations (/hr): policies and the statutory calendar. */
export const complianceHrRoutes: RouteRecordRaw[] = [
  { path: 'compliance/policies', name: 'hr-policies', component: () => import('./pages/PoliciesAdminPage.vue'), meta: { title: 'Policies', access: manage } },
  { path: 'compliance/policies/:id', name: 'hr-policy', component: () => import('./pages/PolicyAdminPage.vue'), meta: { title: 'Policy', access: manage } },
  { path: 'compliance/calendar', name: 'hr-compliance-calendar', component: () => import('./pages/ComplianceCalendarPage.vue'), meta: { title: 'Statutory calendar', access: manage } },
];

/** My Workspace (/me): policies that apply to me. */
export const complianceSelfRoutes: RouteRecordRaw[] = [
  { path: 'policies', name: 'me-policies', component: () => import('./pages/MyPoliciesPage.vue'), meta: { title: 'Policies', access: { permissions: ['compliance.view'], feature } } },
  { path: 'policies/:id', name: 'me-policy', component: () => import('./pages/PolicyReadPage.vue'), meta: { title: 'Policy', access: { permissions: ['compliance.view'], feature } } },
];
