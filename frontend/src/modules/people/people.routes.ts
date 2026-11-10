import type { RouteRecordRaw } from 'vue-router';

/** Administration workspace (/admin): organization structure. */
export const peopleAdminRoutes: RouteRecordRaw[] = [
  { path: 'structure', name: 'admin-structure', component: () => import('./pages/StructurePage.vue'), meta: { title: 'Organization structure', access: { permissions: ['organization.view'] } } },
];

/** HR operations workspace (/hr): employee directory and records. */
export const peopleHrRoutes: RouteRecordRaw[] = [
  { path: 'employees', name: 'hr-employees', component: () => import('./pages/EmployeesPage.vue'), meta: { title: 'Employees', access: { permissions: ['employee.view'], scope: 'TEAM' } } },
  { path: 'employees/bank-changes', name: 'hr-bank-changes', component: () => import('./pages/BankChangesPage.vue'), meta: { title: 'Bank account changes', access: { permissions: ['employee.sensitive.view'] } } },
  { path: 'employees/new', name: 'hr-employee-new', component: () => import('./pages/EmployeeFormPage.vue'), meta: { title: 'Add employee', access: { permissions: ['employee.create'] } } },
  { path: 'employees/:id', name: 'hr-employee', component: () => import('./pages/EmployeeDetailPage.vue'), meta: { title: 'Employee', access: { permissions: ['employee.view'], scope: 'TEAM' } } },
  { path: 'employees/:id/edit', name: 'hr-employee-edit', component: () => import('./pages/EmployeeFormPage.vue'), meta: { title: 'Edit employee', access: { permissions: ['employee.update'] } } },
  { path: 'org-chart', name: 'hr-org-chart', component: () => import('./pages/OrgChartPage.vue'), meta: { title: 'Org chart', fill: true, access: { permissions: ['employee.view'], scope: 'TEAM' } } },
  { path: 'documents/expiring', name: 'hr-documents-expiring', component: () => import('./pages/ExpiringDocumentsPage.vue'), meta: { title: 'Document expiry', access: { permissions: ['employee.document.manage'] } } },
];

/** My Workspace (/me): the signed-in person's employee record. */
export const peopleSelfRoutes: RouteRecordRaw[] = [
  { path: 'employment', name: 'me-employment', component: () => import('./pages/MyEmploymentPage.vue'), meta: { title: 'My employment', access: { tenant: true } } },
];
