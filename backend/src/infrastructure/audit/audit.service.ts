import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { RequestContext } from '../../common/context/request-context';
import { AuditLog } from '../../database/models';

/** Field names whose values must never be written to the audit trail. */
const REDACTED_FIELDS = /(^password$|hash$|secret|token|^bankAccount|^accountNumber|^pan(Number)?$|^aadhaar)/i;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  metadata?: Record<string, unknown>;
  /** Defaults to the request's active organization. Pass `null` for platform-level events. */
  organizationId?: string | null;
  /** Defaults to the authenticated user. */
  actorUserId?: string | null;
}

/** Computes a redacted field-level diff between two snapshots. Fields absent from `after` are ignored. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[] = Object.keys(after),
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after) || after[field] === undefined) continue;
    const from = before[field];
    const to = after[field];
    const same = from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : JSON.stringify(from) === JSON.stringify(to);
    if (same) continue;
    const redact = REDACTED_FIELDS.test(field);
    out[field] = { from: redact ? '[REDACTED]' : from, to: redact ? '[REDACTED]' : to };
  }
  return out;
}

@Injectable()
export class AuditService {
  /**
   * Records an audit entry. Pass the transaction to make the entry atomic with the change.
   * The organization is set explicitly, so tenant auto-scoping is bypassed for the write.
   */
  async record(entry: AuditEntry, transaction?: Transaction): Promise<void> {
    const ctx = RequestContext.get();
    await AuditLog.create(
      {
        organizationId: entry.organizationId === undefined ? (ctx?.organizationId ?? null) : entry.organizationId,
        actorUserId: entry.actorUserId === undefined ? (ctx?.userId ?? null) : entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary?.slice(0, 500) ?? null,
        changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
        metadata: entry.metadata ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent?.slice(0, 512) ?? null,
        requestId: ctx?.requestId ?? null,
      },
      { transaction, skipTenantScope: true },
    );
  }
}
