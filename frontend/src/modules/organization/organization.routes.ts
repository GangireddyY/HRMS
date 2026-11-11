import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): dashboard and organization settings. */
export const organizationRoutes: RouteRecordRaw[] = [
  { path: '', name: 'admin-dashboard', component: () => import('./pages/OrganizationDashboardPage.vue'), meta: { title: 'Administration', access: { permissions: ['organization.view'] } } },
  { path: 'organization', name: 'admin-organization', component: () => import('./pages/OrganizationSettingsPage.vue'), meta: { title: 'Organization settings', access: { permissions: ['organization.view'] } } },
  { path: 'legal-entities', name: 'admin-legal-entities', component: () => import('./pages/LegalEntitiesPage.vue'), meta: { title: 'Legal entities & currencies', access: { permissions: ['organization.view'] } } },
];
