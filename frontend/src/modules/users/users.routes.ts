import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): user management. */
export const usersRoutes: RouteRecordRaw[] = [
  { path: 'users', name: 'admin-users', component: () => import('./pages/UsersPage.vue'), meta: { title: 'Users', access: { permissions: ['user.view'] } } },
  { path: 'users/:id', name: 'admin-user', component: () => import('./pages/UserDetailPage.vue'), meta: { title: 'User', access: { permissions: ['user.view'] } } },
];
