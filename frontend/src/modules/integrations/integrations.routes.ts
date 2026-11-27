import type { RouteRecordRaw } from 'vue-router';

/** Administration (/admin): API keys, webhooks, and the Vector workspace. */
export const integrationsRoutes: RouteRecordRaw[] = [
  { path: 'integrations', name: 'admin-integrations', component: () => import('./pages/IntegrationsPage.vue'), meta: { title: 'Integrations', fill: true, access: { permissions: ['integration.manage'] } } },
  { path: 'vector', name: 'admin-vector', component: () => import('./pages/VectorWorkspacePage.vue'), meta: { title: 'Vector', fill: true, access: { permissions: ['integration.manage'] } } },
];

