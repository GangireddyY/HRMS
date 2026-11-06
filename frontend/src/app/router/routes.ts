import type { RouteRecordRaw } from 'vue-router';
import { ADMIN_PERMISSIONS, HR_OPERATIONS_PERMISSIONS } from '@/core/navigation/workspaces';
import { accountRoutes } from '@/modules/account/account.routes';
import { attendanceAdminRoutes, attendanceHrRoutes, attendanceSelfRoutes } from '@/modules/attendance/attendance.routes';
import { auditRoutes } from '@/modules/audit/audit.routes';
import { authRoutes } from '@/modules/auth/auth.routes';
import { errorRoutes } from '@/modules/errors/errors.routes';
import { hrRoutes } from '@/modules/hr/hr.routes';
import { notificationsRoutes } from '@/modules/notifications/notifications.routes';
import { organizationRoutes } from '@/modules/organization/organization.routes';
import { leaveHrRoutes, leaveSelfRoutes } from '@/modules/leave/leave.routes';
import { onboardingHrRoutes, onboardingSelfRoutes } from '@/modules/onboarding/onboarding.routes';
import { peopleAdminRoutes, peopleHrRoutes, peopleSelfRoutes } from '@/modules/people/people.routes';
import { platformRoutes } from '@/modules/platform/platform.routes';
import { payrollHrRoutes, payrollSelfRoutes } from '@/modules/payroll/payroll.routes';
import { performanceHrRoutes, performanceSelfRoutes } from '@/modules/performance/performance.routes';
import { trainingHrRoutes, trainingSelfRoutes } from '@/modules/training/training.routes';
import { engagementHrRoutes, engagementSelfRoutes } from '@/modules/engagement/engagement.routes';
import { grievanceHrRoutes, grievanceSelfRoutes } from '@/modules/grievance/grievance.routes';
import { benefitsHrRoutes, benefitsSelfRoutes } from '@/modules/benefits/benefits.routes';
import { complianceHrRoutes, complianceSelfRoutes } from '@/modules/compliance/compliance.routes';
import { exitHrRoutes, exitSelfRoutes } from '@/modules/exit/exit.routes';
import { reportsHrRoutes } from '@/modules/reports/reports.routes';
import { careersRoutes, recruitmentHrRoutes, recruitmentSelfRoutes } from '@/modules/recruitment/recruitment.routes';
import { rolesRoutes } from '@/modules/roles/roles.routes';
import { usersRoutes } from '@/modules/users/users.routes';

/**
 * Route table: each layout (workspace) hosts the pages contributed by feature modules.
 * Access rules on a layout apply to all of its pages; pages may narrow them further.
 */
export const routes: RouteRecordRaw[] = [
  // Resolved by the navigation guard to the user's landing page (or the login page).
  { path: '/', name: 'home', component: { render: () => null } },
  {
    path: '/',
    component: () => import('@/layouts/AuthLayout.vue'),
    children: authRoutes,
  },
  {
    path: '/platform',
    component: () => import('@/layouts/PlatformLayout.vue'),
    meta: { access: { platform: 'platform.organizations.view' } },
    children: platformRoutes,
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { access: { permissions: ADMIN_PERMISSIONS } },
    children: [...organizationRoutes, ...peopleAdminRoutes, ...attendanceAdminRoutes, ...usersRoutes, ...rolesRoutes, ...auditRoutes],
  },
  {
    path: '/hr',
    component: () => import('@/layouts/HrLayout.vue'),
    meta: { access: { permissions: HR_OPERATIONS_PERMISSIONS, scope: 'TEAM' } },
    children: [...hrRoutes, ...peopleHrRoutes, ...recruitmentHrRoutes, ...onboardingHrRoutes, ...attendanceHrRoutes, ...leaveHrRoutes, ...payrollHrRoutes, ...performanceHrRoutes, ...trainingHrRoutes, ...engagementHrRoutes, ...grievanceHrRoutes, ...benefitsHrRoutes, ...complianceHrRoutes, ...exitHrRoutes, ...reportsHrRoutes],
  },
  {
    path: '/me',
    component: () => import('@/layouts/EssLayout.vue'),
    children: [...accountRoutes, ...peopleSelfRoutes, ...onboardingSelfRoutes, ...recruitmentSelfRoutes, ...attendanceSelfRoutes, ...leaveSelfRoutes, ...payrollSelfRoutes, ...performanceSelfRoutes, ...trainingSelfRoutes, ...engagementSelfRoutes, ...grievanceSelfRoutes, ...benefitsSelfRoutes, ...complianceSelfRoutes, ...exitSelfRoutes, ...notificationsRoutes],
  },
  ...careersRoutes,
  ...errorRoutes,
];
