import type { RouteRecordRaw } from 'vue-router';

/** Administration (/admin): configurable approval chains. */
export const approvalChainsRoutes: RouteRecordRaw[] = [
  { path: 'approval-chains', name: 'admin-approval-chains', component: () => import('./pages/ApprovalChainsPage.vue'), meta: { title: 'Approval chains', access: { permissions: ['approvals.configure'] } } },
];

/** My Workspace (/me): approval-chain steps waiting for the user (approvers may hold no module role). */
export const approvalInboxRoutes: RouteRecordRaw[] = [
  { path: 'approvals', name: 'me-approvals', component: () => import('./pages/MyApprovalsPage.vue'), meta: { title: 'My approvals', access: { tenant: true } } },
];
