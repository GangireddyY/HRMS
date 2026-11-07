import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { EXIT_LETTER_PREFIX, type ExitLetterType } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, ExitLetter, ExitSettlement, Organization, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { IssueLetterDto, RevokeLetterDto } from './dto/exit.dto';
import { letterBlocker, letterTemplate } from './exit-rules';
import { ExitsService } from './exits.service';

const LABEL: Record<ExitLetterType, string> = { RELIEVING: 'relieving letter', EXPERIENCE: 'experience certificate' };

/**
 * Relieving letters and experience certificates (`exit.manage`, never for one's own exit), issued once the exit is
 * completed. HR starts from a suggested text, edits it and issues it; issued letters are numbered (REL-0001 /
 * EXP-0001) and fixed. A letter can be revoked with a reason and issued again. The employee sees their issued letters
 * and prints them on the organization's letterhead.
 */
@Injectable()
export class ExitLettersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly exits: ExitsService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, caseId: string) {
    const c = await this.exits.find(caseId);
    const access = await this.exits.access(auth, c);
    if (!access.manage && !access.self) throw AppError.forbidden();
    const rows = await ExitLetter.findAll({ where: { caseId, ...(access.manage ? {} : { revokedAt: null }) }, order: [['issuedAt', 'DESC']] });
    const names = await this.names(rows.flatMap((l) => [l.issuedById, l.revokedById]));
    return rows.map((l) => this.summary(l, names));
  }

  /** The suggested letter: today's date (not before the last working day), the template text and the caller as signatory. */
  async draft(auth: AuthContext, caseId: string, type: ExitLetterType) {
    const c = await this.exits.find(caseId);
    if (!(await this.exits.access(auth, c)).manage) throw AppError.forbidden();
    const blocker = letterBlocker(c.status, c.type);
    if (blocker) throw AppError.conflict(blocker);
    const [employee, organization, settlement, issuer, today] = await Promise.all([
      Employee.findByPk(c.employeeId, { include: [{ model: Department, attributes: ['name'] }, { model: Designation, attributes: ['name'] }] }),
      Organization.findByPk(c.organizationId, { attributes: ['name', 'legalName'] }),
      ExitSettlement.findOne({ where: { caseId: c.id }, attributes: ['status'] }),
      this.signatory(auth),
      organizationToday(c.organizationId),
    ]);
    const { subject, body } = letterTemplate(type, {
      organization: organization!.legalName || organization!.name,
      firstName: employee!.firstName,
      fullName: fullName(employee!),
      employeeCode: employee!.employeeCode,
      designation: employee!.designation?.name ?? null,
      department: employee!.department?.name ?? null,
      dateOfJoining: employee!.dateOfJoining,
      lastWorkingDay: c.lastWorkingDay!,
      submittedOn: c.submittedOn,
      exitType: c.type,
      settled: settlement?.status === 'PAID',
    });
    return { type, letterDate: today < c.lastWorkingDay! ? c.lastWorkingDay! : today, subject, body, ...issuer };
  }

  async issue(auth: AuthContext, caseId: string, dto: IssueLetterDto) {
    const id = await this.db.transaction(async (transaction) => {
      const c = await this.exits.find(caseId, transaction);
      if (!(await this.exits.access(auth, c)).manage) throw AppError.forbidden();
      const blocker = letterBlocker(c.status, c.type);
      if (blocker) throw AppError.conflict(blocker);
      const today = await organizationToday(c.organizationId);
      if (dto.letterDate < c.lastWorkingDay!) throw AppError.validation([{ field: 'letterDate', message: `The letter can't be dated before the last working day (${c.lastWorkingDay})` }]);
      if (dto.letterDate > today) throw AppError.validation([{ field: 'letterDate', message: "The letter can't be dated in the future" }]);
      if (await ExitLetter.count({ where: { caseId: c.id, type: dto.type, revokedAt: null }, transaction })) {
        throw AppError.conflict(`A ${LABEL[dto.type]} has already been issued; revoke it to issue a new one`);
      }
      const letter = await ExitLetter.create(
        {
          organizationId: c.organizationId,
          caseId: c.id,
          employeeId: c.employeeId,
          type: dto.type,
          reference: await this.nextReference(dto.type, transaction),
          letterDate: dto.letterDate,
          subject: dto.subject,
          body: dto.body.replace(/\r\n/g, '\n'),
          signatoryName: dto.signatoryName,
          signatoryTitle: dto.signatoryTitle ?? null,
          issuedById: auth.userId,
          issuedAt: new Date(),
        },
        { transaction },
      );
      await this.audit.record({ action: 'exit.letter_issued', entityType: 'ExitCase', entityId: c.id, summary: `${letter.reference} (${LABEL[dto.type]}) issued` }, transaction);
      const userId = (await userIdsOf([c.employeeId], transaction)).get(c.employeeId);
      if (userId && userId !== auth.userId) {
        await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'exit.letter', title: `Your ${LABEL[dto.type]} is ready`, body: `Reference ${letter.reference}.`, link: '/me/exit' }, transaction);
      }
      return letter.id;
    });
    return this.get(auth, caseId, id);
  }

  async get(auth: AuthContext, caseId: string, letterId: string) {
    const c = await this.exits.find(caseId);
    const access = await this.exits.access(auth, c);
    if (!access.manage && !access.self) throw AppError.forbidden();
    const letter = await ExitLetter.findOne({ where: { id: letterId, caseId } });
    if (!letter || (!access.manage && letter.revokedAt)) throw AppError.notFound('Letter');
    const [organization, employee, names] = await Promise.all([
      Organization.findByPk(c.organizationId),
      Employee.findByPk(c.employeeId, { attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }),
      this.names([letter.issuedById, letter.revokedById]),
    ]);
    const o = organization!;
    return {
      ...this.summary(letter, names),
      body: letter.body,
      employee: { name: fullName(employee!), employeeCode: employee!.employeeCode },
      letterhead: {
        name: o.legalName || o.name,
        logoUrl: o.logoUrl,
        address: [o.addressLine1, o.addressLine2, [o.city, o.state, o.postalCode].filter(Boolean).join(' ')].filter((x) => !!x),
        email: o.email,
        phone: o.phone,
        website: o.website,
        registrationNumber: o.registrationNumber,
      },
    };
  }

  async revoke(auth: AuthContext, caseId: string, letterId: string, dto: RevokeLetterDto) {
    await this.db.transaction(async (transaction) => {
      const c = await this.exits.find(caseId, transaction);
      if (!(await this.exits.access(auth, c)).manage) throw AppError.forbidden();
      const letter = await ExitLetter.findOne({ where: { id: letterId, caseId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!letter) throw AppError.notFound('Letter');
      if (letter.revokedAt) throw AppError.conflict('This letter has already been revoked');
      await letter.update({ revokedAt: new Date(), revokedById: auth.userId, revokedReason: dto.reason }, { transaction });
      await this.audit.record({ action: 'exit.letter_revoked', entityType: 'ExitCase', entityId: c.id, summary: `${letter.reference} revoked` }, transaction);
    });
    return this.get(auth, caseId, letterId);
  }

  private async signatory(auth: AuthContext) {
    const [user, self] = await Promise.all([User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'] }), this.scope.self(auth)]);
    const designation = self?.designationId ? await Designation.findByPk(self.designationId, { attributes: ['name'] }) : null;
    return { signatoryName: user ? fullName(user) : '', signatoryTitle: designation?.name ?? null };
  }

  private async nextReference(type: ExitLetterType, transaction: Transaction): Promise<string> {
    const prefix = EXIT_LETTER_PREFIX[type];
    const rows = await ExitLetter.findAll({ where: { reference: { [Op.like]: `${prefix}-%` } }, attributes: ['reference'], raw: true, transaction });
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const max = rows.reduce((m, r) => Math.max(m, Number(pattern.exec(r.reference)?.[1] ?? 0)), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  private summary(l: ExitLetter, names: Map<string, string>) {
    return {
      id: l.id,
      type: l.type,
      reference: l.reference,
      letterDate: l.letterDate,
      subject: l.subject,
      signatoryName: l.signatoryName,
      signatoryTitle: l.signatoryTitle,
      issuedBy: l.issuedById ? (names.get(l.issuedById) ?? 'Former user') : null,
      issuedAt: l.issuedAt,
      revokedAt: l.revokedAt,
      revokedBy: l.revokedById ? (names.get(l.revokedById) ?? 'Former user') : null,
      revokedReason: l.revokedReason,
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
