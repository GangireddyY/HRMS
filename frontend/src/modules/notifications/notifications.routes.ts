import type { RouteRecordRaw } from 'vue-router';

/** Notification inbox (/me/notifications). */
export const notificationsRoutes: RouteRecordRaw[] = [
  { path: 'notifications', name: 'me-notifications', component: () => import('./pages/NotificationsPage.vue'), meta: { title: 'Notifications' } },
];
