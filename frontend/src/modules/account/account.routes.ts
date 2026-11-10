import type { RouteRecordRaw } from 'vue-router';
import { DELEGABLE_PERMISSIONS } from '@contracts';

/** Self-service account pages (/me), available to every signed-in user. */
export const accountRoutes: RouteRecordRaw[] = [
  { path: '', name: 'me-home', component: () => import('./pages/AccountHomePage.vue'), meta: { title: 'Home', access: { tenant: true } } },
  { path: 'profile', name: 'me-profile', component: () => import('./pages/ProfilePage.vue'), meta: { title: 'My profile' } },
  { path: 'security', name: 'me-security', component: () => import('./pages/SecurityPage.vue'), meta: { title: 'Security' } },
  { path: 'appearance', name: 'me-appearance', component: () => import('./pages/AppearancePage.vue'), meta: { title: 'Appearance' } },
  {
    path: 'delegation',
    name: 'me-delegation',
    component: () => import('./pages/ApprovalCoverPage.vue'),
    meta: { title: 'Approval cover', access: { permissions: [...DELEGABLE_PERMISSIONS], scope: 'TEAM' } },
  },
];
