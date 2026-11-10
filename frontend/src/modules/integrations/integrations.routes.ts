import type { RouteRecordRaw } from 'vue-router';

/** Administration (/admin): API keys and webhooks. */
export const integrationsRoutes: RouteRecordRaw[] = [
  { path: 'integrations', name: 'admin-integrations', component: () => import('./pages/IntegrationsPage.vue'), meta: { title: 'Integrations', access: { permissions: ['integration.manage'] } } },
];
