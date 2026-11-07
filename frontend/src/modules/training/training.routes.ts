import type { RouteRecordRaw } from 'vue-router';

const feature = 'training' as const;
const staff = { permissions: ['training.manage', 'training.assign'], scope: 'TEAM' as const, feature };

/** HR operations (/hr): course administration, assignment and team training status. */
export const trainingHrRoutes: RouteRecordRaw[] = [
  { path: 'training/courses', name: 'hr-courses', component: () => import('./pages/CoursesPage.vue'), meta: { title: 'Courses', access: staff } },
  { path: 'training/courses/:id', name: 'hr-course', component: () => import('./pages/CoursePage.vue'), meta: { title: 'Course', access: staff } },
  { path: 'training/team', name: 'hr-team-training', component: () => import('./pages/TeamTrainingPage.vue'), meta: { title: 'Team training', access: staff } },
  { path: 'training/enrollments/:id', name: 'hr-enrollment', component: () => import('./pages/EnrollmentPage.vue'), meta: { title: 'Training', access: staff } },
  { path: 'training/skills', name: 'hr-skills', component: () => import('./pages/SkillMatrixPage.vue'), meta: { title: 'Skill matrix', access: staff } },
];

/** My Workspace (/me): own learning, the catalog and enrolments. */
export const trainingSelfRoutes: RouteRecordRaw[] = [
  { path: 'training', name: 'me-training', component: () => import('./pages/MyLearningPage.vue'), meta: { title: 'My learning', access: { tenant: true, feature } } },
  { path: 'training/catalog', name: 'me-catalog', component: () => import('./pages/CatalogPage.vue'), meta: { title: 'Course catalog', access: { permissions: ['training.view'], feature } } },
  { path: 'training/courses/:id', name: 'me-course', component: () => import('./pages/CoursePage.vue'), meta: { title: 'Course', access: { permissions: ['training.view'], feature } } },
  { path: 'training/enrollments/:id', name: 'me-enrollment', component: () => import('./pages/EnrollmentPage.vue'), meta: { title: 'Training', access: { tenant: true, feature } } },
  { path: 'skills', name: 'me-skills', component: () => import('./pages/MySkillsPage.vue'), meta: { title: 'My skills', access: { permissions: ['training.view'], feature } } },
];
