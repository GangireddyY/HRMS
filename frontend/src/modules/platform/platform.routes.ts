import type { RouteRecordRaw } from 'vue-router';

/** Super-admin console, rendered inside PlatformLayout under /platform. */
export const platformRoutes: RouteRecordRaw[] = [
  { path: '', name: 'platform-dashboard', component: () => import('./pages/PlatformDashboardPage.vue'), meta: { title: 'Platform dashboard' } },
  { path: 'organizations', name: 'platform-organizations', component: () => import('./pages/OrganizationsPage.vue'), meta: { title: 'Organizations' } },
  { path: 'organizations/:id', name: 'platform-organization', component: () => import('./pages/OrganizationDetailPage.vue'), meta: { title: 'Organization' } },
  { path: 'plans', name: 'platform-plans', component: () => import('./pages/PlansPage.vue'), meta: { title: 'Plans' } },
  { path: 'billing', name: 'platform-billing', component: () => import('@/modules/billing/pages/PlatformBillingPage.vue'), meta: { title: 'Billing' } },
  { path: 'billing/:id', name: 'platform-billing-organization', component: () => import('@/modules/billing/pages/OrganizationBillingPage.vue'), meta: { title: 'Organization billing' } },
  { path: 'audit-logs', name: 'platform-audit', component: () => import('./pages/PlatformAuditPage.vue'), meta: { title: 'Platform audit log', access: { platform: 'platform.audit.view' } } },
];
