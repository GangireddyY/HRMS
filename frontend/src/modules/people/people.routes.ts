import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): organization structure. */
export const peopleAdminRoutes: RouteRecordRaw[] = [
  { path: 'structure', name: 'admin-structure', component: () => import('./pages/StructurePage.vue'), meta: { title: 'Organization structure', access: { permissions: ['organization.view'] } } },
];

/** HR operations workspace (/hr): employee directory and records. */
export const peopleHrRoutes: RouteRecordRaw[] = [
  { path: 'employees', name: 'hr-employees', component: () => import('./pages/EmployeesPage.vue'), meta: { title: 'Employees', access: { permissions: ['employee.view'], scope: 'TEAM' } } },
  { path: 'employees/new', name: 'hr-employee-new', component: () => import('./pages/EmployeeFormPage.vue'), meta: { title: 'Add employee', access: { permissions: ['employee.create'] } } },
  { path: 'employees/:id', name: 'hr-employee', component: () => import('./pages/EmployeeDetailPage.vue'), meta: { title: 'Employee', access: { permissions: ['employee.view'], scope: 'TEAM' } } },
  { path: 'employees/:id/edit', name: 'hr-employee-edit', component: () => import('./pages/EmployeeFormPage.vue'), meta: { title: 'Edit employee', access: { permissions: ['employee.update'] } } },
];
