import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): audit trail and sign-in history. */
export const auditRoutes: RouteRecordRaw[] = [
  { path: 'audit-logs', name: 'admin-audit', component: () => import('./pages/AuditLogPage.vue'), meta: { title: 'Audit log', access: { permissions: ['audit.view'] } } },
  { path: 'login-history', name: 'admin-login-history', component: () => import('./pages/LoginHistoryPage.vue'), meta: { title: 'Login history', access: { permissions: ['audit.login_history.view'] } } },
];
