import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Transaction } from 'sequelize';
import { FILING_FILE_MAX_BYTES, FILING_LOOKBACK_MONTHS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { addDays, addMonths } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { ComplianceFiling, ComplianceObligation, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { fullName, organizationToday } from '../employees/employee-people';
import { RECOMMENDED_OBLIGATIONS, filingState, occurrences, scheduleProblems } from './compliance-rules';
import type { CalendarQueryDto, FilingDto, ObligationDto, UpdateObligationDto } from './dto/compliance.dto';

export interface UploadedFilingFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const MAX_RANGE_DAYS = 400;

/**
 * Statutory calendar (`compliance.manage`):
 * obligations with a yearly schedule of due dates, and the filings recorded against each due date (reference number
 * and an optional receipt). Due dates are computed from the schedule; only filings are stored.
 */
@Injectable()
export class ComplianceCalendarService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async obligations() {
    const rows = await ComplianceObligation.findAll({ order: [['active', 'DESC'], ['category', 'ASC'], ['title', 'ASC']] });
    const names = await this.names(rows.map((r) => r.ownerUserId));
    const filed = rows.length ? await ComplianceFiling.count({ where: { obligationId: rows.map((r) => r.id) }, group: ['obligationId'] }) : [];
    const counts = new Map((filed as unknown as { obligationId: string; count: number }[]).map((f) => [f.obligationId, Number(f.count)]));
    return rows.map((o) => ({ ...this.present(o, names), filings: counts.get(o.id) ?? 0 }));
  }

  async create(auth: AuthContext, dto: ObligationDto) {
    await this.validate(dto);
    const o = await this.db.transaction(async (transaction) => {
      const created = await ComplianceObligation.create({ organizationId: auth.organizationId!, ...this.columns(dto), createdById: auth.userId }, { transaction });
      await this.audit.record({ action: 'compliance.obligation_created', entityType: 'ComplianceObligation', entityId: created.id, summary: `Compliance obligation "${created.title}" added` }, transaction);
      return created;
    });
    return this.one(o.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateObligationDto) {
    await this.db.transaction(async (transaction) => {
      const o = await this.find(id, transaction);
      const merged: ObligationDto = { title: o.title, category: o.category, authority: o.authority, description: o.description, dueDates: o.dueDates, startsOn: o.startsOn, endsOn: o.endsOn, ownerUserId: o.ownerUserId, active: o.active, ...dto };
      await this.validate(merged);
      await o.update(this.columns(merged), { transaction });
      await this.audit.record({ action: 'compliance.obligation_updated', entityType: 'ComplianceObligation', entityId: o.id, summary: `Compliance obligation "${o.title}" updated` }, transaction);
    });
    return this.one(id);
  }

  /** Deletes an obligation that has no filings (otherwise deactivate it to keep the record). */
  async remove(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const o = await this.find(id, transaction);
      if (await ComplianceFiling.count({ where: { obligationId: o.id }, transaction })) throw AppError.conflict('It has filings on record; deactivate it instead');
      await o.destroy({ transaction });
      await this.audit.record({ action: 'compliance.obligation_deleted', entityType: 'ComplianceObligation', entityId: id, summary: `Compliance obligation "${o.title}" deleted` }, transaction);
    });
  }

  /** Adds the recommended statutory obligations that aren't in the calendar yet (matched by title), from today. */
  async addRecommended(auth: AuthContext) {
    const today = await organizationToday(auth.organizationId!);
    const added = await this.db.transaction(async (transaction) => {
      const existing = new Set((await ComplianceObligation.findAll({ attributes: ['title'], transaction })).map((o) => o.title.toLowerCase()));
      const missing = RECOMMENDED_OBLIGATIONS.filter((r) => !existing.has(r.title.toLowerCase()));
      for (const r of missing) {
        await ComplianceObligation.create({ organizationId: auth.organizationId!, ...r, startsOn: today, ownerUserId: auth.userId, createdById: auth.userId }, { transaction });
      }
      await this.audit.record({ action: 'compliance.obligations_recommended', entityType: 'ComplianceObligation', summary: `${missing.length} recommended compliance obligation${missing.length === 1 ? '' : 's'} added` }, transaction);
      return missing.length;
    });
    return { added };
  }

  /** Due dates in a range with their state; optionally also everything still overdue from the last 12 months. */
  async calendar(auth: AuthContext, query: CalendarQueryDto) {
    if (query.to < query.from) throw AppError.validation([{ field: 'to', message: 'The range must end after it starts' }]);
    if (addDays(query.from, MAX_RANGE_DAYS) < query.to) throw AppError.validation([{ field: 'to', message: `Up to ${MAX_RANGE_DAYS} days at a time` }]);
    const today = await organizationToday(auth.organizationId!);
    const obligations = await ComplianceObligation.findAll({ where: { active: true } });
    const lookback = addMonths(today, -FILING_LOOKBACK_MONTHS);
    const due: { o: ComplianceObligation; dueOn: string }[] = [];
    for (const o of obligations) {
      for (const d of occurrences(o, query.from, query.to)) due.push({ o, dueOn: d });
      if (query.overdue && query.from > lookback) {
        for (const d of occurrences(o, lookback, addDays(query.from < today ? query.from : today, -1))) due.push({ o, dueOn: d });
      }
    }
    const filings = due.length ? await ComplianceFiling.findAll({ where: { obligationId: [...new Set(due.map((d) => d.o.id))], dueOn: [...new Set(due.map((d) => d.dueOn))] } }) : [];
    const filed = new Map(filings.map((f) => [`${f.obligationId}|${f.dueOn}`, f]));
    const names = await this.names([...obligations.map((o) => o.ownerUserId), ...filings.map((f) => f.completedById)]);
    const items = due
      .map(({ o, dueOn }) => {
        const f = filed.get(`${o.id}|${dueOn}`);
        return { obligation: this.present(o, names), dueOn, state: filingState(dueOn, !!f, today), filing: f ? this.presentFiling(f, names) : null };
      })
      .filter((i) => !(i.dueOn < query.from && i.state !== 'OVERDUE'))
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.obligation.title.localeCompare(b.obligation.title));
    return {
      today,
      items,
      counts: { overdue: items.filter((i) => i.state === 'OVERDUE').length, dueSoon: items.filter((i) => i.state === 'DUE_SOON').length, done: items.filter((i) => i.state === 'DONE').length },
    };
  }

  async file(auth: AuthContext, obligationId: string, dto: FilingDto, file?: UploadedFilingFile) {
    const o = await this.find(obligationId);
    const today = await organizationToday(o.organizationId);
    if (!occurrences(o, dto.dueOn, dto.dueOn).length) throw AppError.validation([{ field: 'dueOn', message: 'That is not a due date of this obligation' }]);
    if (dto.completedOn > today) throw AppError.validation([{ field: 'completedOn', message: "The filing date can't be in the future" }]);
    let stored: { key: string; name: string; type: string; size: number } | null = null;
    if (file) {
      if (file.size > FILING_FILE_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The file must be 5 MB or smaller' }]);
      const type = detectDocumentType(file.buffer);
      if (!type) throw AppError.validation([{ field: 'file', message: 'Upload a PDF, PNG, JPG or WebP file' }]);
      stored = { key: `organizations/${o.organizationId}/compliance/${o.id}/${randomUUID()}`, name: safeFileName(file.originalname, o.title, type), type, size: file.size };
      await this.storage.put(stored.key, file.buffer, type);
    }
    try {
      await this.db.transaction(async (transaction) => {
        if (await ComplianceFiling.count({ where: { obligationId: o.id, dueOn: dto.dueOn }, transaction })) throw AppError.conflict('This due date has already been filed');
        const f = await ComplianceFiling.create(
          {
            organizationId: o.organizationId,
            obligationId: o.id,
            dueOn: dto.dueOn,
            completedOn: dto.completedOn,
            reference: dto.reference ?? null,
            note: dto.note ?? null,
            fileKey: stored?.key ?? null,
            fileName: stored?.name ?? null,
            fileType: stored?.type ?? null,
            fileSize: stored?.size ?? null,
            completedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'compliance.filed', entityType: 'ComplianceFiling', entityId: f.id, summary: `"${o.title}" due ${dto.dueOn} filed on ${dto.completedOn}${dto.completedOn > dto.dueOn ? ' (late)' : ''}` }, transaction);
      });
    } catch (e) {
      if (stored) await this.storage.deleteQuietly([stored.key]);
      throw e;
    }
    return { dueOn: dto.dueOn, obligationId: o.id };
  }

  async unfile(auth: AuthContext, filingId: string) {
    let key: string | null = null;
    await this.db.transaction(async (transaction) => {
      const f = await ComplianceFiling.findByPk(filingId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!f) throw AppError.notFound('Filing');
      const o = (await ComplianceObligation.findByPk(f.obligationId, { transaction }))!;
      key = f.fileKey;
      await f.destroy({ transaction });
      await this.audit.record({ action: 'compliance.filing_removed', entityType: 'ComplianceFiling', entityId: filingId, summary: `Filing of "${o.title}" due ${f.dueOn} removed` }, transaction);
    });
    if (key) await this.storage.deleteQuietly([key]);
  }

  async download(filingId: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const f = await ComplianceFiling.findByPk(filingId);
    if (!f?.fileKey) throw AppError.notFound('File');
    return { stream: await this.storage.get(f.fileKey), fileName: f.fileName!, contentType: f.fileType!, size: f.fileSize! };
  }

  private async find(id: string, transaction?: Transaction) {
    const o = await ComplianceObligation.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!o) throw AppError.notFound('Obligation');
    return o;
  }

  private async one(id: string) {
    const o = await this.find(id);
    return this.present(o, await this.names([o.ownerUserId]));
  }

  private async validate(dto: ObligationDto) {
    const problems = scheduleProblems(dto.dueDates).map((message) => ({ field: 'dueDates', message }));
    if (dto.endsOn && dto.endsOn < dto.startsOn) problems.push({ field: 'endsOn', message: 'It must end after it starts' });
    if (dto.ownerUserId && !(await OrganizationMembership.count({ where: { userId: dto.ownerUserId, status: 'ACTIVE' } }))) problems.push({ field: 'ownerUserId', message: 'Choose a member of the organization' });
    if (problems.length) throw AppError.validation(problems);
  }

  private columns(dto: ObligationDto) {
    return {
      title: dto.title,
      category: dto.category,
      authority: dto.authority ?? null,
      description: dto.description ?? null,
      dueDates: [...dto.dueDates].sort(),
      startsOn: dto.startsOn,
      endsOn: dto.endsOn ?? null,
      ownerUserId: dto.ownerUserId ?? null,
      active: dto.active ?? true,
    };
  }

  private present(o: ComplianceObligation, names: Map<string, string>) {
    return {
      id: o.id,
      title: o.title,
      category: o.category,
      authority: o.authority,
      description: o.description,
      dueDates: o.dueDates,
      startsOn: o.startsOn,
      endsOn: o.endsOn,
      owner: o.ownerUserId ? { id: o.ownerUserId, name: names.get(o.ownerUserId) ?? 'Former user' } : null,
      active: o.active,
    };
  }

  private presentFiling(f: ComplianceFiling, names: Map<string, string>) {
    return {
      id: f.id,
      completedOn: f.completedOn,
      late: f.completedOn > f.dueOn,
      reference: f.reference,
      note: f.note,
      file: f.fileKey ? { name: f.fileName, type: f.fileType, size: f.fileSize } : null,
      completedBy: f.completedById ? (names.get(f.completedById) ?? 'Former user') : null,
      createdAt: f.createdAt,
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}