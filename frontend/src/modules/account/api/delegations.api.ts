import { http } from '@/core/http/http-client';

export type DelegationStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'REVOKED';

export interface Delegation {
  id: string;
  delegator: string;
  delegate: string;
  startsOn: string;
  endsOn: string;
  reason: string | null;
  status: DelegationStatus;
  canEnd: boolean;
}

export interface DelegationOverview {
  today: string;
  maxDays: number;
  canDelegate: boolean;
  delegable: { key: string; label: string }[];
  given: Delegation[];
  received: Delegation[];
}

export interface DelegationCandidate {
  employeeId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
}

export const delegationsApi = {
  overview: () => http.get<DelegationOverview>('/approvals/delegations'),
  candidates: (search?: string) => http.get<DelegationCandidate[]>('/approvals/delegations/candidates', { search: search || undefined }),
  create: (body: { delegateEmployeeId: string; startsOn: string; endsOn: string; reason?: string | null }) => http.post<Delegation>('/approvals/delegations', body),
  revoke: (id: string) => http.post<Delegation>(`/approvals/delegations/${id}/revoke`),
};
