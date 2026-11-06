import type { RouteRecordRaw } from 'vue-router';

/** HR operations (/hr): onboarding cases, checklists and probation. */
export const onboardingHrRoutes: RouteRecordRaw[] = [
  { path: 'onboarding', name: 'hr-onboarding', component: () => import('./pages/OnboardingCasesPage.vue'), meta: { title: 'Onboarding', access: { permissions: ['onboarding.view'], scope: 'TEAM' } } },
  { path: 'onboarding/checklists', name: 'hr-onboarding-checklists', component: () => import('./pages/ChecklistTemplatesPage.vue'), meta: { title: 'Onboarding checklists', access: { permissions: ['onboarding.view'], scope: 'TEAM' } } },
  { path: 'onboarding/probation', name: 'hr-probation', component: () => import('./pages/ProbationPage.vue'), meta: { title: 'Probation', access: { permissions: ['onboarding.view', 'onboarding.confirmation.approve'], scope: 'TEAM' } } },
  { path: 'onboarding/:id', name: 'hr-onboarding-case', component: () => import('./pages/OnboardingCasePage.vue'), meta: { title: 'Onboarding', access: { permissions: ['onboarding.view'], scope: 'TEAM' } } },
];

/** My Workspace (/me): own checklist and manager tasks for new team members (access is decided per case by the API). */
export const onboardingSelfRoutes: RouteRecordRaw[] = [
  { path: 'onboarding', name: 'me-onboarding', component: () => import('./pages/MyOnboardingPage.vue'), meta: { title: 'Onboarding', access: { tenant: true, feature: 'onboarding' } } },
  { path: 'onboarding/cases/:id', name: 'me-onboarding-case', component: () => import('./pages/OnboardingCasePage.vue'), meta: { title: 'Onboarding', access: { tenant: true, feature: 'onboarding' } } },
];
