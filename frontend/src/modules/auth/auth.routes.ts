import type { RouteRecordRaw } from 'vue-router';

/** Public authentication pages, rendered inside AuthLayout. */
export const authRoutes: RouteRecordRaw[] = [
  { path: 'login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: { public: true, guestOnly: true, title: 'Sign in' } },
  { path: 'forgot-password', name: 'forgot-password', component: () => import('./pages/ForgotPasswordPage.vue'), meta: { public: true, guestOnly: true, title: 'Forgot password' } },
  { path: 'reset-password', name: 'reset-password', component: () => import('./pages/ResetPasswordPage.vue'), meta: { public: true, title: 'Reset password' } },
  { path: 'accept-invitation', name: 'accept-invitation', component: () => import('./pages/AcceptInvitationPage.vue'), meta: { public: true, title: 'Accept invitation' } },
  { path: 'register', name: 'register', component: () => import('./pages/RegisterOrganizationPage.vue'), meta: { public: true, guestOnly: true, title: 'Create organization' } },
];
