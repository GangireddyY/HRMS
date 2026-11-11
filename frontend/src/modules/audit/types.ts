import type { LogArchiveKind, LogArchiveStatus } from '@contracts';

export interface LogArchive {
  id: string;
  kind: LogArchiveKind;
  /** Records created before this day are in the file. */
  before: string;
  firstRecordAt: string | null;
  lastRecordAt: string | null;
  recordCount: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  /** The stored file can't be deleted or changed until then (Object Lock); null when retention is off. */
  lockedUntil: string | null;
  status: LogArchiveStatus;
  downloadedAt: string | null;
  purgedAt: string | null;
  /** Null when the records were deleted together with a later archive. */
  purgedCount: number | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  purgedBy: { id: string; name: string } | null;
}

export interface LogArchivePreview {
  kind: LogArchiveKind;
  before: string;
  count: number;
  firstRecordAt: string | null;
  lastRecordAt: string | null;
  maxRecords: number;
}

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
