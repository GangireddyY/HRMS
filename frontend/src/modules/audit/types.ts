export interface DailyLoginStat {
  day: string;
  outcome: string;
  count: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; email: string; firstName: string; lastName: string } | null;
  organization?: { id: string; name: string } | null;
}

export interface LoginEventRow {
  id: string;
  email?: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'MFA_CHALLENGE' | 'LOCKED';
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string } | null;
  organization?: { id: string; name: string } | null;
}
