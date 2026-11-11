import type { ApprovalInboxItem, ApprovalSubject } from '@contracts';
import { http } from '@/core/http/http-client';

type Decision = 'approve' | 'reject';

/** Each kind of request is decided through its own module's endpoint (resignations can only be accepted). */
const ENDPOINTS: Record<ApprovalSubject, Partial<Record<Decision, (id: string) => string>>> = {
  LEAVE: { approve: (id) => `/leave/requests/${id}/approve`, reject: (id) => `/leave/requests/${id}/reject` },
  EXPENSE: { approve: (id) => `/payroll/reimbursements/${id}/approve`, reject: (id) => `/payroll/reimbursements/${id}/reject` },
  TRAVEL: { approve: (id) => `/travel/requests/${id}/approve`, reject: (id) => `/travel/requests/${id}/reject` },
  EXIT: { approve: (id) => `/exits/${id}/approve` },
  OFFER: { approve: (id) => `/recruitment/offers/${id}/approve`, reject: (id) => `/recruitment/offers/${id}/reject-approval` },
};

export const canReject = (subject: ApprovalSubject) => !!ENDPOINTS[subject].reject;

export const approvalInboxApi = {
  waiting: () => http.get<ApprovalInboxItem[]>('/approvals/waiting'),
  decide: (item: ApprovalInboxItem, decision: Decision, body: { note?: string | null; lastWorkingDay?: string }) => {
    const path = ENDPOINTS[item.subject][decision];
    if (!path) throw new Error(`${item.subject} requests can't be rejected`);
    return http.post<unknown>(path(item.subjectId), body);
  },
};
