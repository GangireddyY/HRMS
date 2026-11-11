import type { ApprovalChainConditions, ApprovalChainStep, ApprovalSubject } from '@contracts';
import { http } from '@/core/http/http-client';

export interface ApprovalChainRow {
  id: string;
  subject: ApprovalSubject;
  name: string;
  priority: number;
  conditions: ApprovalChainConditions;
  steps: (ApprovalChainStep & { approverName: string | null })[];
  isActive: boolean;
  /** Requests in progress on this chain. */
  pending: number;
  updatedAt: string;
}

export interface ApprovalChainInput {
  subject: ApprovalSubject;
  name: string;
  priority: number;
  conditions: ApprovalChainConditions;
  steps: ApprovalChainStep[];
  isActive: boolean;
}

export const approvalChainsApi = {
  list: () => http.get<ApprovalChainRow[]>('/approvals/chains'),
  create: (body: ApprovalChainInput) => http.post<ApprovalChainRow>('/approvals/chains', body),
  update: (id: string, body: ApprovalChainInput) => http.put<ApprovalChainRow>(`/approvals/chains/${id}`, body),
  remove: (id: string) => http.delete<void>(`/approvals/chains/${id}`),
};
