import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): personal-data retention and erasure. */
export const privacyRoutes: RouteRecordRaw[] = [
  { path: 'privacy', name: 'admin-privacy', component: () => import('./pages/PrivacyPage.vue'), meta: { title: 'Privacy & retention', access: { permissions: ['privacy.manage'] } } },
];
