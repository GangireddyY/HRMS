import type { RouteRecordRaw } from 'vue-router';

/** HR operations (/hr): approvals, team calendar, balances and configuration. */
export const leaveHrRoutes: RouteRecordRaw[] = [
  { path: 'leave/requests', name: 'hr-leave-requests', component: () => import('./pages/LeaveRequestsPage.vue'), meta: { title: 'Leave requests', access: { permissions: ['leave.approve', 'leave.view'], scope: 'TEAM' } } },
  { path: 'leave/calendar', name: 'hr-leave-calendar', component: () => import('./pages/LeaveCalendarPage.vue'), meta: { title: 'Team leave calendar', access: { permissions: ['leave.view'], scope: 'TEAM' } } },
  { path: 'leave/balances', name: 'hr-leave-balances', component: () => import('./pages/LeaveBalancesPage.vue'), meta: { title: 'Leave balances', access: { permissions: ['leave.view'], scope: 'TEAM' } } },
  { path: 'leave/types', name: 'hr-leave-types', component: () => import('./pages/LeaveTypesPage.vue'), meta: { title: 'Leave types', access: { permissions: ['leave.configure'] } } },
];

/** My Workspace (/me): own balances and requests. */
export const leaveSelfRoutes: RouteRecordRaw[] = [
  { path: 'leave', name: 'me-leave', component: () => import('./pages/MyLeavePage.vue'), meta: { title: 'Leave', access: { permissions: ['leave.view'] } } },
];
