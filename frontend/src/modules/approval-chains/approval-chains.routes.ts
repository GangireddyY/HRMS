import type { RouteRecordRaw } from 'vue-router';

/** Administration (/admin): configurable approval chains. */
export const approvalChainsRoutes: RouteRecordRaw[] = [
  { path: 'approval-chains', name: 'admin-approval-chains', component: () => import('./pages/ApprovalChainsPage.vue'), meta: { title: 'Approval chains', access: { permissions: ['approvals.configure'] } } },
];
