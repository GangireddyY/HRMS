import type { RouteRecordRaw } from 'vue-router';

/** Top-level error pages. The catch-all must stay last in the route table. */
export const errorRoutes: RouteRecordRaw[] = [
  { path: '/forbidden', name: 'forbidden', component: () => import('./pages/ForbiddenPage.vue'), meta: { title: 'Access denied' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./pages/NotFoundPage.vue'), meta: { public: true, title: 'Not found' } },
];
