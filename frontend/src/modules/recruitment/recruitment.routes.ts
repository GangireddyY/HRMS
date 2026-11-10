import type { RouteRecordRaw } from 'vue-router';

const view = { permissions: ['recruitment.view'], feature: 'recruitment' as const };

/** HR operations (/hr): requisitions, jobs and pipelines, candidates. */
export const recruitmentHrRoutes: RouteRecordRaw[] = [
  {
    path: 'recruitment/requisitions',
    name: 'hr-requisitions',
    component: () => import('./pages/RequisitionsPage.vue'),
    meta: { title: 'Requisitions', access: { permissions: ['recruitment.requisition.create', 'recruitment.requisition.approve', 'recruitment.view'], scope: 'TEAM', feature: 'recruitment' } },
  },
  { path: 'recruitment/jobs', name: 'hr-jobs', component: () => import('./pages/JobsPage.vue'), meta: { title: 'Jobs', access: view } },
  { path: 'recruitment/jobs/:id', name: 'hr-job', component: () => import('./pages/JobPage.vue'), meta: { title: 'Job pipeline', access: view } },
  { path: 'recruitment/applications/:id', name: 'hr-application', component: () => import('./pages/ApplicationPage.vue'), meta: { title: 'Application', access: view } },
  { path: 'recruitment/candidates', name: 'hr-candidates', component: () => import('./pages/CandidatesPage.vue'), meta: { title: 'Candidates', access: view } },
  { path: 'recruitment/candidates/:id', name: 'hr-candidate', component: () => import('./pages/CandidatePage.vue'), meta: { title: 'Candidate', access: view } },
  {
    path: 'recruitment/offer-letter',
    name: 'hr-offer-letter',
    component: () => import('./pages/OfferLetterSettingsPage.vue'),
    meta: { title: 'Offers & letters', access: { permissions: ['recruitment.offer.manage'], feature: 'recruitment' } },
  },
];

/** My Workspace (/me): interviews where the user is a panelist. */
export const recruitmentSelfRoutes: RouteRecordRaw[] = [
  { path: 'interviews', name: 'me-interviews', component: () => import('./pages/MyInterviewsPage.vue'), meta: { title: 'My interviews', access: { permissions: ['recruitment.interview.feedback'], feature: 'recruitment' } } },
];

/** Public careers pages (no sign-in). */
export const careersRoutes: RouteRecordRaw[] = [
  { path: '/careers/:slug', name: 'careers', component: () => import('./pages/CareersPage.vue'), meta: { title: 'Careers', public: true } },
  { path: '/careers/:slug/jobs/:jobId', name: 'careers-job', component: () => import('./pages/CareerJobPage.vue'), meta: { title: 'Careers', public: true } },
  { path: '/offer/:token', name: 'offer-portal', component: () => import('./pages/OfferPortalPage.vue'), meta: { title: 'Your offer', public: true } },
];
