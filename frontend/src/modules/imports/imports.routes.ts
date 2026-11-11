import type { RouteRecordRaw } from 'vue-router';

export const IMPORT_PERMISSIONS = ['leave.allocate', 'employee.salary.revise', 'assets.manage', 'employee.update'];

/** HR operations (/hr): bulk CSV imports per module. */
export const importsHrRoutes: RouteRecordRaw[] = [
  { path: 'imports', name: 'hr-imports', component: () => import('./pages/ImportsPage.vue'), meta: { title: 'Bulk import', access: { permissions: IMPORT_PERMISSIONS } } },
];
