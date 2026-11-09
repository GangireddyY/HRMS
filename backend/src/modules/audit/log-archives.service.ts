import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Op, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { csvCell } from '../../common/utils/csv';
import { zonedInstant, zonedParts } from '../../common/utils/zoned-time';
import { LOG_ARCHIVE_MAX_RECORDS, type LogArchiveKind } from '../../contracts';
import { DatabaseService } from '../../database/database.service';
import { AuditLog, LogArchive, LoginEvent, Organization, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';

const BATCH = 5_000;
const LABEL: Record<LogArchiveKind, { title: string; file: string }> = {
  AUDIT_LOG: { title: 'Audit trail', file: 'audit-trail' },
  LOGIN_HISTORY: { title: 'Login history', file: 'login-history' },
};
const fullName = (u: User | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const json = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v));
const line = (cells: unknown[]) => cells.map(csvCell).join(',');

/** Rows of one log created before `before`, oldest first, read in batches. */
async function* rows(kind: LogArchiveKind, before: Date): AsyncGenerator<string> {
  const where = { createdAt: { [Op.lt]: before } };
  if (kind === 'AUDIT_LOG') {
    yield line(['Time (UTC)', 'Action', 'Entity type', 'Entity ID', 'Summary', 'Actor email', 'Actor name', 'Changes', 'Metadata', 'IP address', 'User agent', 'Request ID', 'Record ID']);
    for (let offset = 0; ; offset += BATCH) {
      const batch = await AuditLog.findAll({
        where,
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        limit: BATCH,
        offset,
        include: [{ model: User, as: 'actor', attributes: ['email', 'firstName', 'lastName'] }],
      });
      for (const r of batch) {
        yield line([r.createdAt.toISOString(), r.action, r.entityType, r.entityId, r.summary, r.actor?.email, fullName(r.actor), json(r.changes), json(r.metadata), r.ipAddress, r.userAgent, r.requestId, r.id]);
      }
      if (batch.length < BATCH) return;
    }
  }
  yield line(['Time (UTC)', 'Email', 'User name', 'Outcome', 'Failure reason', 'IP address', 'User agent', 'Record ID']);
  for (let offset = 0; ; offset += BATCH) {
    const batch = await LoginEvent.findAll({
      where,
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: BATCH,
      offset,
      include: [{ model: User, attributes: ['firstName', 'lastName'] }],
    });
    for (const r of batch) yield line([r.createdAt.toISOString(), r.email, fullName(r.user), r.outcome, r.failureReason, r.ipAddress, r.userAgent, r.id]);
    if (batch.length < BATCH) return;
  }
}

/**
 * Archives of the audit trail and login history (audit.purge). Records are deleted only through an archive: its
 * CSV file is saved to storage and downloaded first, and the delete removes exactly the archived records.
 */
@Injectable()
export class LogArchivesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, kind?: LogArchiveKind) {
    const tz = await this.timeZone(auth);
    const archives = await LogArchive.findAll({
      where: kind ? { kind } : {},
      order: [['createdAt', 'DESC']],
      limit: 50,
      include: [
        { model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'purgedBy', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    return archives.map((a) => this.present(a, tz));
  }

  /** How many records an archive up to `before` (a date in the organization's time zone) would hold. */
  async preview(auth: AuthContext, kind: LogArchiveKind, before: string) {
    const cutoff = await this.cutoff(auth, before);
    const { count, first, last } = await this.range(kind, cutoff);
    return { kind, before, count, firstRecordAt: first, lastRecordAt: last, maxRecords: LOG_ARCHIVE_MAX_RECORDS };
  }

  /** Writes every record created before `before` to a CSV file in storage. Nothing is deleted yet. */
  async create(auth: AuthContext, kind: LogArchiveKind, before: string) {
    const tz = await this.timeZone(auth);
    const cutoff = await this.cutoff(auth, before, tz);
    const { count, first, last } = await this.range(kind, cutoff);
    if (!count) throw AppError.validation([{ field: 'before', message: 'There are no records before this date' }]);
    if (count > LOG_ARCHIVE_MAX_RECORDS) {
      throw AppError.validation([{ field: 'before', message: `${count.toLocaleString('en')} records is more than one archive holds (${LOG_ARCHIVE_MAX_RECORDS.toLocaleString('en')}). Pick an earlier date and archive in parts.` }]);
    }

    const lines: string[] = [];
    for await (const l of rows(kind, cutoff)) lines.push(l);
    const written = lines.length - 1;
    if (written !== count) throw AppError.conflict('The records changed while the archive was being written. Please try again.');
    const data = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
    const sha256 = createHash('sha256').update(data).digest('hex');

    const archive = LogArchive.build({
      organizationId: auth.organizationId!,
      kind,
      recordsBefore: cutoff,
      firstRecordAt: first,
      lastRecordAt: last,
      recordCount: count,
      fileName: `${LABEL[kind].file}-before-${before}.csv`,
      storageKey: '',
      sizeBytes: data.length,
      sha256,
      status: 'ARCHIVED',
      createdById: auth.userId,
    });
    archive.storageKey = `organizations/${auth.organizationId}/log-archives/${archive.id}.csv`;
    await this.storage.put(archive.storageKey, data, 'text/csv; charset=utf-8');
    try {
      await this.db.transaction(async (transaction) => {
        await archive.save({ transaction });
        await this.audit.record(
          {
            action: 'audit.archive_created',
            entityType: 'LogArchive',
            entityId: archive.id,
            summary: `${LABEL[kind].title} archived: ${count} records before ${before}`,
            metadata: { kind, before, recordCount: count, fileName: archive.fileName, sha256 },
          },
          transaction,
        );
      });
    } catch (e) {
      await this.storage.deleteQuietly([archive.storageKey]);
      throw e;
    }
    return this.present(archive, tz);
  }

  /** The archive file; the first download unlocks deleting its records. */
  async download(auth: AuthContext, id: string): Promise<{ archive: LogArchive; stream: Readable }> {
    const archive = await this.find(id);
    const stream = await this.storage.get(archive.storageKey);
    await this.db.transaction(async (transaction) => {
      if (!archive.downloadedAt) await archive.update({ downloadedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'audit.archive_downloaded', entityType: 'LogArchive', entityId: archive.id, summary: `Archive "${archive.fileName}" downloaded` }, transaction);
    });
    return { archive, stream };
  }

  /**
   * Deletes the archived records. `recordCount` must match what the admin was shown, the file must have been
   * downloaded, and the records must still be exactly the archived ones; otherwise nothing is deleted.
   */
  async purge(auth: AuthContext, id: string, recordCount: number) {
    const tz = await this.timeZone(auth);
    const result = await this.db.transaction(async (transaction) => {
      const archive = await LogArchive.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!archive) throw AppError.notFound('Archive');
      if (archive.status === 'PURGED') throw AppError.conflict('These records have already been deleted.');
      if (!archive.downloadedAt) throw AppError.conflict('Download the archive file and keep it safe before deleting the records.');
      if (recordCount !== archive.recordCount) throw AppError.validation([{ field: 'recordCount', message: `Type ${archive.recordCount} to confirm` }]);

      const where = { createdAt: { [Op.lt]: archive.recordsBefore } };
      const current = archive.kind === 'AUDIT_LOG' ? await AuditLog.count({ where, transaction }) : await LoginEvent.count({ where, transaction });
      if (current !== archive.recordCount) {
        throw AppError.conflict(`The records no longer match this archive (${current} now, ${archive.recordCount} archived). Create a new archive.`);
      }

      const deleted = archive.kind === 'AUDIT_LOG' ? await this.deleteAuditLogs(archive.recordsBefore, transaction) : await LoginEvent.destroy({ where, transaction });
      if (deleted !== archive.recordCount) throw AppError.conflict('The records changed during the delete. Nothing was deleted; please try again.');

      const now = new Date();
      await archive.update({ status: 'PURGED', purgedAt: now, purgedCount: deleted, purgedById: auth.userId }, { transaction });
      // Older archives of the same log are fully covered by this delete.
      await LogArchive.update(
        { status: 'PURGED', purgedAt: now, purgedById: auth.userId },
        { where: { kind: archive.kind, status: 'ARCHIVED', recordsBefore: { [Op.lte]: archive.recordsBefore }, id: { [Op.ne]: archive.id } }, transaction },
      );
      // Recorded after the delete, so this entry stays in the audit trail.
      await this.audit.record(
        {
          action: archive.kind === 'AUDIT_LOG' ? 'audit.purged' : 'audit.login_history_purged',
          entityType: 'LogArchive',
          entityId: archive.id,
          summary: `${deleted} ${LABEL[archive.kind].title.toLowerCase()} records before ${zonedParts(archive.recordsBefore, tz).date} deleted after archiving to "${archive.fileName}"`,
          metadata: { recordCount: deleted, fileName: archive.fileName, sha256: archive.sha256, firstRecordAt: archive.firstRecordAt, lastRecordAt: archive.lastRecordAt },
        },
        transaction,
      );
      return archive;
    });
    return this.present(result, tz);
  }

  /** The audit trail is append-only; the trigger lets this transaction (and only it) delete. */
  private async deleteAuditLogs(before: Date, transaction: Transaction): Promise<number> {
    await this.db.sequelize.query("SET LOCAL hrms.audit_purge = 'on'", { transaction });
    const deleted = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: before } }, transaction });
    await this.db.sequelize.query("SET LOCAL hrms.audit_purge = 'off'", { transaction });
    return deleted;
  }

  private async range(kind: LogArchiveKind, before: Date) {
    const where = { createdAt: { [Op.lt]: before } };
    const [count, first, last] =
      kind === 'AUDIT_LOG'
        ? await Promise.all([
            AuditLog.count({ where }),
            AuditLog.findOne({ where, order: [['createdAt', 'ASC']], attributes: ['createdAt'] }),
            AuditLog.findOne({ where, order: [['createdAt', 'DESC']], attributes: ['createdAt'] }),
          ])
        : await Promise.all([
            LoginEvent.count({ where }),
            LoginEvent.findOne({ where, order: [['createdAt', 'ASC']], attributes: ['createdAt'] }),
            LoginEvent.findOne({ where, order: [['createdAt', 'DESC']], attributes: ['createdAt'] }),
          ]);
    return { count, first: first?.createdAt ?? null, last: last?.createdAt ?? null };
  }

  private async find(id: string): Promise<LogArchive> {
    const archive = await LogArchive.findByPk(id);
    if (!archive) throw AppError.notFound('Archive');
    return archive;
  }

  private async timeZone(auth: AuthContext): Promise<string> {
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['timezone'] });
    return org?.timezone || 'UTC';
  }

  /** Start of `date` in the organization's time zone; only past days, so new records can't fall inside. */
  private async cutoff(auth: AuthContext, date: string, tz?: string): Promise<Date> {
    const zone = tz ?? (await this.timeZone(auth));
    if (date > zonedParts(new Date(), zone).date) throw AppError.validation([{ field: 'before', message: 'Pick today or an earlier date' }]);
    return zonedInstant(date, 0, zone);
  }

  private present(a: LogArchive, tz: string) {
    const name = (u: User | null | undefined) => (u ? { id: u.id, name: fullName(u) } : null);
    return {
      id: a.id,
      kind: a.kind,
      before: zonedParts(a.recordsBefore, tz).date,
      firstRecordAt: a.firstRecordAt,
      lastRecordAt: a.lastRecordAt,
      recordCount: a.recordCount,
      fileName: a.fileName,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      status: a.status,
      downloadedAt: a.downloadedAt ?? null,
      purgedAt: a.purgedAt ?? null,
      purgedCount: a.purgedCount ?? null,
      createdAt: a.createdAt,
      createdBy: name(a.createdBy),
      purgedBy: name(a.purgedBy),
    };
  }
}
