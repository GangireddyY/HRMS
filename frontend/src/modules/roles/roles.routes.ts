import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): roles and permissions. */
export const rolesRoutes: RouteRecordRaw[] = [
  { path: 'roles', name: 'admin-roles', component: () => import('./pages/RolesPage.vue'), meta: { title: 'Roles & permissions', access: { permissions: ['role.view'] } } },
  { path: 'roles/:id', name: 'admin-role', component: () => import('./pages/RoleDetailPage.vue'), meta: { title: 'Role', fill: true, access: { permissions: ['role.view'] } } },
];
