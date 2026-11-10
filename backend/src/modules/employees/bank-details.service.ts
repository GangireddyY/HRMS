import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { BankDetailChange, Employee, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { bankDetailsEmail } from '../../infrastructure/mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { fullName, userIdsOf } from './employee-people';
import { EmployeeScopeService } from './employee-scope.service';

export interface BankChangeInput {
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
}

const REVIEW = ['employee.update', 'employee.sensitive.view'] as const;
const EMPLOYEE_ATTRIBUTES = [
  'id',
  'organizationId',
  'firstName',
  'lastName',
  'employeeCode',
  'managerId',
  'departmentId',
  'membershipId',
  'workEmail',
  'personalEmail',
  'bankAccountEncrypted',
  'bankAccountLast4',
  'bankIfsc',
  'bankName',
];

/**
 * Salary bank accounts are changed with maker-checker: the first account can be entered directly, but replacing an
 * existing one creates a request that someone else with sensitive-data access approves (never the requester or the
 * employee). The employee is told by email and in the app at every step, and payroll keeps paying the current account
 * until the change is approved.
 */
@Injectable()
export class BankDetailsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly crypto: EncryptionService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Splits a sensitive-details update: unchanged bank values are ignored; a first account is applied directly; a change
   * to an existing account becomes a pending request. Returns the employee columns to write now.
   */
  async handle(auth: AuthContext, employee: Employee, input: BankChangeInput, transaction: Transaction): Promise<Record<string, unknown>> {
    // A pending change shares the employee account's context, so approving it copies the ciphertext as is.
    const context = ctx.employee('bank_account', employee.id);
    const current = { account: employee.bankAccountEncrypted ? this.crypto.decrypt(employee.bankAccountEncrypted, context) : null, ifsc: employee.bankIfsc, name: employee.bankName };
    const next = {
      account: input.bankAccountNumber === undefined ? current.account : input.bankAccountNumber || null,
      ifsc: input.bankIfsc === undefined ? current.ifsc : input.bankIfsc || null,
      name: input.bankName === undefined ? current.name : input.bankName || null,
    };
    const changed = next.account !== current.account || next.ifsc !== current.ifsc || next.name !== current.name;
    if (!changed) return {};
    const accountChanged = next.account !== current.account || next.ifsc !== current.ifsc;
    const columns = {
      bankAccountEncrypted: next.account ? this.crypto.encrypt(next.account, context) : null,
      bankAccountLast4: next.account?.slice(-4) ?? null,
      bankIfsc: next.ifsc,
      bankName: next.name,
    };
    // First account on file, or only the bank's display name corrected: no approval needed.
    if (!current.account || !accountChanged) {
      if (current.account || next.account)
        await this.tell(
          employee,
          current.account ? 'The name of your salary bank was updated in your HR record.' : `A salary bank account ending ${columns.bankAccountLast4} was added to your HR record.`,
          auth,
          transaction,
        );
      return columns;
    }
    await BankDetailChange.update({ status: 'CANCELLED' }, { where: { employeeId: employee.id, status: 'PENDING' }, transaction });
    try {
      const change = await BankDetailChange.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          accountEncrypted: columns.bankAccountEncrypted,
          accountLast4: columns.bankAccountLast4,
          ifsc: next.ifsc,
          bankName: next.name,
          requestedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: 'employee.bank_change_requested',
          entityType: 'Employee',
          entityId: employee.id,
          summary: `Salary account change to ••••${columns.bankAccountLast4 ?? '—'} requested for ${fullName(employee)}`,
          metadata: { changeId: change.id },
        },
        transaction,
      );
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('Another bank account change for this employee is waiting for approval');
      throw e;
    }
    await this.tell(
      employee,
      `A change of your salary bank account to one ending ${columns.bankAccountLast4 ?? '—'} was requested. It takes effect only after a second person in HR approves it.`,
      auth,
      transaction,
    );
    return {};
  }

  /** The open request for an employee, for the sensitive-details card. */
  async pending(auth: AuthContext, employee: Pick<Employee, 'id' | 'managerId' | 'departmentId' | 'membershipId'>) {
    const change = await BankDetailChange.findOne({ where: { employeeId: employee.id, status: 'PENDING' } });
    if (!change) return null;
    const requester = change.requestedById ? await User.findByPk(change.requestedById, { attributes: ['id', 'firstName', 'lastName'] }) : null;
    return {
      id: change.id,
      accountLast4: change.accountLast4,
      ifsc: change.ifsc,
      bankName: change.bankName,
      requestedBy: requester ? fullName(requester) : null,
      requestedAt: change.createdAt,
      canReview: change.requestedById !== auth.userId && employee.membershipId !== auth.membershipId,
    };
  }

  async list(auth: AuthContext) {
    const scoped = await this.scope.where(auth, 'employee.sensitive.view', 'employeeId');
    if (!scoped) return [];
    const rows = await BankDetailChange.findAll({
      where: { [Op.and]: [scoped, { status: 'PENDING' }] },
      include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'membershipId'] }],
      order: [['createdAt', 'ASC']],
    });
    return rows.map((r) => ({
      id: r.id,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null,
      accountLast4: r.accountLast4,
      ifsc: r.ifsc,
      bankName: r.bankName,
      requestedAt: r.createdAt,
      canReview: r.requestedById !== auth.userId && r.employee?.membershipId !== auth.membershipId,
    }));
  }

  async approve(auth: AuthContext, id: string) {
    return this.review(auth, id, async (change, employee, transaction) => {
      await employee.update(
        { bankAccountEncrypted: change.accountEncrypted, bankAccountLast4: change.accountLast4, bankIfsc: change.ifsc, bankName: change.bankName, updatedById: auth.userId },
        { transaction },
      );
      await change.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date() }, { transaction });
      await this.audit.record(
        {
          action: 'employee.bank_change_approved',
          entityType: 'Employee',
          entityId: employee.id,
          summary: `Salary account change to ••••${change.accountLast4 ?? '—'} approved for ${fullName(employee)}`,
          metadata: { changeId: id },
        },
        transaction,
      );
      await this.tell(employee, `Your salary bank account was changed to one ending ${change.accountLast4 ?? '—'}. Your next salary will be paid there.`, auth, transaction);
    });
  }

  async reject(auth: AuthContext, id: string, note: string | null | undefined) {
    if (!note || note.trim().length < 3) throw AppError.validation([{ field: 'note', message: 'Say why the change is rejected' }]);
    return this.review(auth, id, async (change, employee, transaction) => {
      await change.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: note.trim() }, { transaction });
      await this.audit.record(
        { action: 'employee.bank_change_rejected', entityType: 'Employee', entityId: employee.id, summary: `Salary account change for ${fullName(employee)} rejected`, metadata: { changeId: id } },
        transaction,
      );
      await this.tell(employee, `The requested change of your salary bank account was rejected: ${note.trim()} Your salary stays with the current account.`, auth, transaction);
    });
  }

  private async review(auth: AuthContext, id: string, fn: (change: BankDetailChange, employee: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const change = await BankDetailChange.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!change) throw AppError.notFound('Bank account change');
      const employee = (await Employee.findByPk(change.employeeId, { attributes: EMPLOYEE_ATTRIBUTES, transaction }))!;
      for (const permission of REVIEW) if (!(await this.scope.covers(auth, permission, employee))) throw AppError.notFound('Bank account change');
      if (change.status !== 'PENDING') throw AppError.conflict(`This change is already ${change.status.toLowerCase()}`);
      if (change.requestedById === auth.userId) throw AppError.forbidden('Someone other than the requester must approve a bank account change');
      if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't approve a change to your own bank account");
      await fn(change, employee, transaction);
    });
    return { id };
  }

  /** In-app notification and email (work and personal address) to the employee. */
  private async tell(employee: Employee, event: string, auth: AuthContext, transaction: Transaction) {
    const userId = (await userIdsOf([employee.id], transaction)).get(employee.id);
    if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'security', title: 'Salary bank account', body: event, link: '/me/employment' }, transaction);
    const to = [...new Set([employee.workEmail, employee.personalEmail].filter((x): x is string => !!x))];
    for (const address of to) await this.mail.queue(bankDetailsEmail(address, employee.firstName, event), { transaction });
  }
}
