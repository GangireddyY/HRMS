import type { RouteRecordRaw } from 'vue-router';

const view = { permissions: ['payroll.view'], feature: 'payroll' as const };

/** HR operations (/hr): payroll runs, salaries, reimbursement approvals and setup. */
export const payrollHrRoutes: RouteRecordRaw[] = [
  { path: 'payroll/runs', name: 'hr-payroll-runs', component: () => import('./pages/PayrollRunsPage.vue'), meta: { title: 'Payroll runs', access: view } },
  { path: 'payroll/runs/:id', name: 'hr-payroll-run', component: () => import('./pages/PayrollRunPage.vue'), meta: { title: 'Payroll run', access: view } },
  { path: 'payroll/payslips/:id', name: 'hr-payslip', component: () => import('./pages/PayslipPage.vue'), meta: { title: 'Payslip', access: view } },
  { path: 'payroll/salaries', name: 'hr-salaries', component: () => import('./pages/SalariesPage.vue'), meta: { title: 'Salaries', access: { permissions: ['employee.salary.view'], scope: 'TEAM', feature: 'payroll' } } },
  {
    path: 'payroll/reimbursements',
    name: 'hr-reimbursements',
    component: () => import('./pages/ReimbursementsPage.vue'),
    meta: { title: 'Reimbursements', access: { permissions: ['payroll.reimbursement.approve', 'payroll.view'], scope: 'TEAM', feature: 'payroll' } },
  },
  { path: 'payroll/setup', name: 'hr-payroll-setup', component: () => import('./pages/PayrollSetupPage.vue'), meta: { title: 'Payroll setup', access: { permissions: ['payroll.configure', 'payroll.view'], feature: 'payroll' } } },
];

/** My Workspace (/me): payslips, salary & tax declaration, reimbursement claims. */
export const payrollSelfRoutes: RouteRecordRaw[] = [
  { path: 'payslips', name: 'me-payslips', component: () => import('./pages/MyPayslipsPage.vue'), meta: { title: 'Payslips', access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } } },
  { path: 'payslips/:id', name: 'me-payslip', component: () => import('./pages/PayslipPage.vue'), meta: { title: 'Payslip', access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } } },
  { path: 'salary', name: 'me-salary', component: () => import('./pages/MySalaryPage.vue'), meta: { title: 'Salary & tax', access: { tenant: true, feature: 'payroll' } } },
  { path: 'reimbursements', name: 'me-reimbursements', component: () => import('./pages/MyReimbursementsPage.vue'), meta: { title: 'Reimbursements', access: { permissions: ['payroll.reimbursement.apply'], feature: 'payroll' } } },
];
