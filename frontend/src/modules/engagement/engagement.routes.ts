import type { RouteRecordRaw } from 'vue-router';

const feature = 'engagement' as const;
const view = { permissions: ['engagement.view'], feature };

/** HR operations (/hr): announcements, surveys and suggestions. */
export const engagementHrRoutes: RouteRecordRaw[] = [
  { path: 'engagement/announcements', name: 'hr-announcements', component: () => import('./pages/AnnouncementsAdminPage.vue'), meta: { title: 'Announcements', access: { permissions: ['engagement.announcement.manage'], feature } } },
  { path: 'engagement/surveys', name: 'hr-surveys', component: () => import('./pages/SurveysAdminPage.vue'), meta: { title: 'Surveys', access: { permissions: ['engagement.survey.manage'], feature } } },
  { path: 'engagement/surveys/:id', name: 'hr-survey-results', component: () => import('./pages/SurveyResultsPage.vue'), meta: { title: 'Survey results', access: { permissions: ['engagement.survey.manage'], feature } } },
  { path: 'engagement/suggestions', name: 'hr-suggestions', component: () => import('./pages/SuggestionsInboxPage.vue'), meta: { title: 'Suggestions', access: { permissions: ['engagement.survey.manage'], feature } } },
];

/** My Workspace (/me): company feed, recognition, surveys and suggestions. */
export const engagementSelfRoutes: RouteRecordRaw[] = [
  { path: 'engagement', name: 'me-engagement', component: () => import('./pages/EngagementPage.vue'), meta: { title: 'Company', access: view } },
  { path: 'engagement/announcements/:id', name: 'me-announcement', component: () => import('./pages/AnnouncementPage.vue'), meta: { title: 'Announcement', access: view } },
  { path: 'engagement/surveys/:id', name: 'me-survey', component: () => import('./pages/SurveyTakePage.vue'), meta: { title: 'Survey', access: view } },
  { path: 'engagement/suggestions', name: 'me-suggestions', component: () => import('./pages/MySuggestionsPage.vue'), meta: { title: 'Suggestions', access: view } },
];
