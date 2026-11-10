import type { RouteRecordRaw } from 'vue-router';

const view = { permissions: ['payroll.view'], feature: 'payroll' as const };
const loanHandlers = { permissions: ['payroll.loan.approve', 'payroll.loan.manage', 'payroll.view'], feature: 'payroll' as const };

/** HR operations (/hr): payroll runs, salaries, reimbursement approvals and setup. */
export const payrollHrRoutes: RouteRecordRaw[] = [
  { path: 'payroll/runs', name: 'hr-payroll-runs', component: () => import('./pages/PayrollRunsPage.vue'), meta: { title: 'Payroll runs', access: view } },
  { path: 'payroll/runs/:id', name: 'hr-payroll-run', component: () => import('./pages/PayrollRunPage.vue'), meta: { title: 'Payroll run', access: view } },
  { path: 'payroll/payslips/:id', name: 'hr-payslip', component: () => import('./pages/PayslipPage.vue'), meta: { title: 'Payslip', access: view } },
  { path: 'payroll/salaries', name: 'hr-salaries', component: () => import('./pages/SalariesPage.vue'), meta: { title: 'Salaries', access: { permissions: ['employee.salary.view'], scope: 'TEAM', feature: 'payroll' } } },
  {
    path: 'payroll/salary-revisions',
    name: 'hr-salary-revisions',
    component: () => import('./pages/SalaryRevisionsPage.vue'),
    meta: { title: 'Salary revisions', access: { permissions: ['employee.salary.view'], scope: 'TEAM', feature: 'payroll' } },
  },
  {
    path: 'payroll/reimbursements',
    name: 'hr-reimbursements',
    component: () => import('./pages/ReimbursementsPage.vue'),
    meta: { title: 'Reimbursements', access: { permissions: ['payroll.reimbursement.approve', 'payroll.reimbursement.finance', 'payroll.view'], scope: 'TEAM', feature: 'payroll' } },
  },
  { path: 'payroll/setup', name: 'hr-payroll-setup', component: () => import('./pages/PayrollSetupPage.vue'), meta: { title: 'Payroll setup', access: { permissions: ['payroll.configure', 'payroll.view'], feature: 'payroll' } } },
  { path: 'payroll/loans', name: 'hr-loans', component: () => import('./pages/LoansPage.vue'), meta: { title: 'Loans & advances', access: loanHandlers } },
  { path: 'payroll/loans/:id', name: 'hr-loan', component: () => import('./pages/LoanPage.vue'), meta: { title: 'Loan', access: loanHandlers } },
  { path: 'payroll/tax', name: 'hr-payroll-tax', component: () => import('./pages/TaxCompliancePage.vue'), meta: { title: 'Tax proofs & returns', access: { permissions: ['payroll.process'], feature: 'payroll' } } },
];

/** My Workspace (/me): payslips, salary & tax declaration, reimbursement claims. */
export const payrollSelfRoutes: RouteRecordRaw[] = [
  { path: 'payslips', name: 'me-payslips', component: () => import('./pages/MyPayslipsPage.vue'), meta: { title: 'Payslips', access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } } },
  { path: 'payslips/:id', name: 'me-payslip', component: () => import('./pages/PayslipPage.vue'), meta: { title: 'Payslip', access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } } },
  { path: 'salary', name: 'me-salary', component: () => import('./pages/MySalaryPage.vue'), meta: { title: 'Salary & tax', access: { tenant: true, feature: 'payroll' } } },
  { path: 'reimbursements', name: 'me-reimbursements', component: () => import('./pages/MyReimbursementsPage.vue'), meta: { title: 'Reimbursements', access: { permissions: ['payroll.reimbursement.apply'], feature: 'payroll' } } },
  { path: 'loans', name: 'me-loans', component: () => import('./pages/MyLoansPage.vue'), meta: { title: 'Loans & advances', access: { permissions: ['payroll.loan.apply'], feature: 'payroll' } } },
  { path: 'loans/:id', name: 'me-loan', component: () => import('./pages/LoanPage.vue'), meta: { title: 'Loan', access: { permissions: ['payroll.loan.apply'], feature: 'payroll' } } },
];
