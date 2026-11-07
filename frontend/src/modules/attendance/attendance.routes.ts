import type { RouteRecordRaw } from 'vue-router';

/** My Workspace (/me): own attendance. */
export const attendanceSelfRoutes: RouteRecordRaw[] = [
  { path: 'attendance', name: 'me-attendance', component: () => import('./pages/MyAttendancePage.vue'), meta: { title: 'My attendance', access: { permissions: ['attendance.view'] } } },
];

/** HR operations (/hr): registers, approvals, closing and shifts. */
export const attendanceHrRoutes: RouteRecordRaw[] = [
  { path: 'attendance', name: 'hr-attendance', component: () => import('./pages/AttendanceRegisterPage.vue'), meta: { title: 'Attendance register', access: { permissions: ['attendance.view'], scope: 'TEAM' } } },
  { path: 'attendance/employees/:id', name: 'hr-attendance-employee', component: () => import('./pages/EmployeeAttendancePage.vue'), meta: { title: 'Employee attendance', access: { permissions: ['attendance.view'], scope: 'TEAM' } } },
  { path: 'attendance/regularizations', name: 'hr-regularizations', component: () => import('./pages/RegularizationsPage.vue'), meta: { title: 'Attendance approvals', access: { permissions: ['attendance.regularize.approve'], scope: 'TEAM' } } },
  { path: 'attendance/roster', name: 'hr-roster', component: () => import('./pages/RosterPage.vue'), meta: { title: 'Roster', access: { permissions: ['attendance.configure', 'attendance.view'], scope: 'TEAM' } } },
  { path: 'attendance/closing', name: 'hr-attendance-closing', component: () => import('./pages/ClosingPage.vue'), meta: { title: 'Monthly closing', access: { permissions: ['attendance.close'] } } },
  { path: 'attendance/shifts', name: 'hr-shifts', component: () => import('./pages/ShiftsPage.vue'), meta: { title: 'Shifts', access: { permissions: ['attendance.configure'] } } },
  { path: 'attendance/devices', name: 'hr-attendance-devices', component: () => import('./pages/DevicesPage.vue'), meta: { title: 'Attendance devices', access: { permissions: ['attendance.configure'] } } },
];

/** Administration (/admin): holiday calendar. */
export const attendanceAdminRoutes: RouteRecordRaw[] = [
  { path: 'holidays', name: 'admin-holidays', component: () => import('./pages/HolidaysPage.vue'), meta: { title: 'Holidays', access: { permissions: ['organization.view'] } } },
];
