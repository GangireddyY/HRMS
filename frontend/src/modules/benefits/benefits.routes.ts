import type { RouteRecordRaw } from 'vue-router';

const feature = 'benefits' as const;
const manage = { permissions: ['benefits.manage'], feature };

/** HR operations (/hr): benefit plans and enrolments. */
export const benefitsHrRoutes: RouteRecordRaw[] = [
  { path: 'benefits/plans', name: 'hr-benefit-plans', component: () => import('./pages/BenefitPlansPage.vue'), meta: { title: 'Benefit plans', access: manage } },
  { path: 'benefits/plans/:id', name: 'hr-benefit-plan', component: () => import('./pages/BenefitPlanPage.vue'), meta: { title: 'Benefit plan', access: manage } },
  { path: 'benefits/enrollments', name: 'hr-benefit-enrollments', component: () => import('./pages/BenefitEnrollmentsPage.vue'), meta: { title: 'Benefit enrolments', access: manage } },
];

/** My Workspace (/me): my benefits. */
export const benefitsSelfRoutes: RouteRecordRaw[] = [
  { path: 'benefits', name: 'me-benefits', component: () => import('./pages/MyBenefitsPage.vue'), meta: { title: 'Benefits', access: { permissions: ['benefits.view'], feature } } },
];
