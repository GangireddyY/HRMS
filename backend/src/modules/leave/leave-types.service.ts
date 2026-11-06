import { Injectable } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { RECOMMENDED_LEAVE_TYPES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { LeaveLedgerEntry, LeaveRequest, LeaveType, Organization } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import type { LeaveSettingsDto, LeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave.dto';

export function presentLeaveType(t: LeaveType) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    color: t.color,
    isPaid: t.isPaid,
    unlimited: t.unlimited,
    annualQuota: Number(t.annualQuota),
    accrualFrequency: t.accrualFrequency,
    prorateOnJoining: t.prorateOnJoining,
    carryForwardLimit: Number(t.carryForwardLimit),
    encashable: t.encashable,
    allowHalfDay: t.allowHalfDay,
    allowNegativeBalance: t.allowNegativeBalance,
    countNonWorkingDays: t.countNonWorkingDays,
    minNoticeDays: t.minNoticeDays,
    maxBackdatedDays: t.maxBackdatedDays,
    maxConsecutiveDays: t.maxConsecutiveDays,
    eligibleAfterDays: t.eligibleAfterDays,
    applicableGender: t.applicableGender,
    isActive: t.isActive,
  };
}

/** Leave types (with their policy) and organization-wide leave settings. */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await LeaveType.findAll({ order: [['isActive', 'DESC'], ['name', 'ASC']] });
    return rows.map(presentLeaveType);
  }

  async create(auth: AuthContext, dto: LeaveTypeDto) {
    const values = this.normalize(dto);
    const row = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const created = await LeaveType.create({ ...values, code: dto.code, name: dto.name, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'leave_type.created', entityType: 'LeaveType', entityId: created.id, summary: `Leave type ${created.code} – ${created.name} created` }, transaction);
        return created;
      }),
    );
    return presentLeaveType(row);
  }

  async update(auth: AuthContext, id: string, dto: UpdateLeaveTypeDto) {
    const row = await this.find(id);
    const merged = { ...presentLeaveType(row), ...dto };
    const values = this.normalize(merged);
    if (dto.code && dto.code !== row.code && (await this.inUse(id))) {
      throw AppError.validation([{ field: 'code', message: 'The code of a leave type that has been used cannot change' }]);
    }
    const before = row.get({ plain: true, clone: true }) as Record<string, unknown>;
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        await row.update({ ...values, ...(dto.code ? { code: dto.code } : {}), ...(dto.name ? { name: dto.name } : {}), updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'leave_type.updated', entityType: 'LeaveType', entityId: id, summary: `Leave type ${row.code} updated`, changes: diff(before, dto as Record<string, unknown>) }, transaction);
      }),
    );
    return presentLeaveType(row);
  }

  async remove(id: string): Promise<void> {
    const row = await this.find(id);
    if (await this.inUse(id)) throw AppError.conflict(`${row.name} has balances or requests. Mark it inactive instead.`);
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record({ action: 'leave_type.deleted', entityType: 'LeaveType', entityId: id, summary: `Leave type ${row.code} – ${row.name} deleted` }, transaction);
    });
  }

  /** Creates the recommended starter types that do not exist yet (by code); returns how many were added. */
  async addRecommended(auth: AuthContext) {
    const existing = new Set((await LeaveType.findAll({ attributes: ['code'] })).map((t) => t.code));
    const missing = RECOMMENDED_LEAVE_TYPES.filter((t) => !existing.has(t.code));
    await this.db.transaction(async (transaction) => {
      for (const t of missing) {
        const carry = 'carryForwardLimit' in t ? t.carryForwardLimit : 0;
        await LeaveType.create({ ...t, annualQuota: String(t.annualQuota), carryForwardLimit: String(carry), organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction });
      }
      if (missing.length) {
        await this.audit.record({ action: 'leave_type.recommended_added', entityType: 'LeaveType', summary: `Recommended leave types added: ${missing.map((t) => t.code).join(', ')}` }, transaction);
      }
    });
    return { added: missing.length, types: await this.list() };
  }

  async settings(organizationId: string) {
    const org = await Organization.findByPk(organizationId, { attributes: ['id', 'leaveYearStartMonth', 'timezone'] });
    return { leaveYearStartMonth: org!.leaveYearStartMonth, timeZone: org!.timezone };
  }

  async updateSettings(auth: AuthContext, dto: LeaveSettingsDto) {
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['id', 'leaveYearStartMonth'] });
    if (org!.leaveYearStartMonth !== dto.leaveYearStartMonth && (await LeaveLedgerEntry.count()) > 0) {
      throw AppError.conflict('The leave year cannot change once balances exist; it would re-date every accrual and carry-forward.');
    }
    await this.db.transaction(async (transaction) => {
      await Organization.update({ leaveYearStartMonth: dto.leaveYearStartMonth, updatedById: auth.userId }, { where: { id: auth.organizationId! }, transaction });
      await this.audit.record(
        { action: 'leave.settings_updated', entityType: 'Organization', entityId: auth.organizationId!, changes: { leaveYearStartMonth: { from: org!.leaveYearStartMonth, to: dto.leaveYearStartMonth } } },
        transaction,
      );
    });
    return this.settings(auth.organizationId!);
  }

  private normalize(dto: Partial<ReturnType<typeof presentLeaveType>> | LeaveTypeDto) {
    const unlimited = !!dto.unlimited;
    const accrualFrequency = unlimited ? 'NONE' : (dto.accrualFrequency ?? 'YEARLY');
    const issues = [];
    if (unlimited && ((dto.carryForwardLimit ?? 0) > 0 || dto.encashable)) issues.push({ field: 'unlimited', message: 'Unlimited types have no balance to carry forward or encash' });
    if (accrualFrequency !== 'NONE' && !(Number(dto.annualQuota) > 0)) issues.push({ field: 'annualQuota', message: 'Set the yearly quota (or choose "Granted by HR only")' });
    if (dto.allowNegativeBalance && unlimited) issues.push({ field: 'allowNegativeBalance', message: 'Unlimited types have no balance' });
    if (issues.length) throw AppError.validation(issues);
    const out: Partial<LeaveType> = {
      description: dto.description ?? null,
      color: dto.color ?? '#6366f1',
      isPaid: dto.isPaid ?? true,
      unlimited,
      annualQuota: String(unlimited ? 0 : (dto.annualQuota ?? 0)),
      accrualFrequency,
      prorateOnJoining: dto.prorateOnJoining ?? true,
      carryForwardLimit: String(unlimited ? 0 : (dto.carryForwardLimit ?? 0)),
      encashable: unlimited ? false : (dto.encashable ?? false),
      allowHalfDay: dto.allowHalfDay ?? true,
      allowNegativeBalance: unlimited ? false : (dto.allowNegativeBalance ?? false),
      countNonWorkingDays: dto.countNonWorkingDays ?? false,
      minNoticeDays: dto.minNoticeDays ?? 0,
      maxBackdatedDays: dto.maxBackdatedDays ?? 0,
      maxConsecutiveDays: dto.maxConsecutiveDays ?? null,
      eligibleAfterDays: dto.eligibleAfterDays ?? 0,
      applicableGender: dto.applicableGender ?? null,
      isActive: dto.isActive ?? true,
    };
    return out;
  }

  private async inUse(id: string): Promise<boolean> {
    return (await LeaveLedgerEntry.count({ where: { leaveTypeId: id } })) > 0 || (await LeaveRequest.count({ where: { leaveTypeId: id } })) > 0;
  }

  private async find(id: string): Promise<LeaveType> {
    const row = await LeaveType.findByPk(id);
    if (!row) throw AppError.notFound('Leave type');
    return row;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) {
        const field = String(e.parent?.message ?? '').includes('_code_') ? 'code' : 'name';
        throw AppError.validation([{ field, message: `A leave type with this ${field} already exists` }]);
      }
      throw e;
    }
  }
}
