import { Injectable } from '@nestjs/common';
import { fn, col, Op, UniqueConstraintError } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Employee, PayGroup, PayrollRun, Payslip } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { AssignPayGroupDto, PayGroupDto, UpdatePayGroupDto } from './dto/payroll.dto';

/**
 * Pay groups: employees paid in their own payroll runs (contractors, a subsidiary, a different pay day). Everyone
 * without a group is paid in the main run. Each group has its own monthly runs, processed and approved like the main
 * one; someone is never paid by two runs for the same month.
 */
@Injectable()
export class PayGroupsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [groups, counts, main] = await Promise.all([
      PayGroup.findAll({ order: [['name', 'ASC']] }),
      Employee.findAll({ attributes: ['payGroupId', [fn('COUNT', col('id')), 'count']], where: { status: ['ACTIVE', 'ON_NOTICE'], payGroupId: { [Op.ne]: null } }, group: ['payGroupId'], raw: true }) as unknown as Promise<{ payGroupId: string; count: string }[]>,
      Employee.count({ where: { status: ['ACTIVE', 'ON_NOTICE'], payGroupId: null } }),
    ]);
    const by = new Map(counts.map((c) => [c.payGroupId, Number(c.count)]));
    return {
      mainEmployees: main,
      groups: groups.map((g) => ({ id: g.id, name: g.name, description: g.description, isActive: g.isActive, employees: by.get(g.id) ?? 0 })),
    };
  }

  async create(auth: AuthContext, dto: PayGroupDto) {
    const g = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const created = await PayGroup.create({ organizationId: auth.organizationId!, name: dto.name, description: dto.description ?? null, isActive: dto.isActive ?? true, createdById: auth.userId }, { transaction });
        await this.audit.record({ action: 'payroll.pay_group_created', entityType: 'PayGroup', entityId: created.id, summary: `Pay group "${created.name}" created` }, transaction);
        return created;
      }),
    );
    return { id: g.id, name: g.name, description: g.description, isActive: g.isActive, employees: 0 };
  }

  async update(auth: AuthContext, id: string, dto: UpdatePayGroupDto) {
    const g = await PayGroup.findByPk(id);
    if (!g) throw AppError.notFound('Pay group');
    if (dto.isActive === false && (await this.openRuns(id))) throw AppError.conflict(`Finish or cancel the open payroll run of ${g.name} first`);
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        await g.update({ ...(dto.name ? { name: dto.name } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) }, { transaction });
        await this.audit.record({ action: 'payroll.pay_group_updated', entityType: 'PayGroup', entityId: id, summary: `Pay group "${g.name}" updated` }, transaction);
      }),
    );
    return (await this.list()).groups.find((x) => x.id === id)!;
  }

  async remove(id: string) {
    const g = await PayGroup.findByPk(id);
    if (!g) throw AppError.notFound('Pay group');
    if (await Employee.count({ where: { payGroupId: id } })) throw AppError.conflict(`Move the people in ${g.name} to another group first`);
    if (await PayrollRun.count({ where: { payGroupId: id } })) throw AppError.conflict(`${g.name} has payroll history. Mark it inactive instead.`);
    await this.db.transaction(async (transaction) => {
      await g.destroy({ transaction });
      await this.audit.record({ action: 'payroll.pay_group_deleted', entityType: 'PayGroup', entityId: id, summary: `Pay group "${g.name}" deleted` }, transaction);
    });
  }

  /** Moves people into a group (or back to the main run), never while a run they're part of is in progress. */
  async assign(auth: AuthContext, dto: AssignPayGroupDto) {
    const target = dto.payGroupId ? await PayGroup.findByPk(dto.payGroupId) : null;
    if (dto.payGroupId && (!target || !target.isActive)) throw AppError.validation([{ field: 'payGroupId', message: 'Choose an active pay group' }]);
    const employees = await Employee.findAll({ where: { id: dto.employeeIds }, attributes: ['id', 'employeeCode', 'payGroupId'] });
    if (employees.length !== new Set(dto.employeeIds).size) throw AppError.validation([{ field: 'employeeIds', message: 'Some employees were not found' }]);
    const moving = employees.filter((e) => (e.payGroupId ?? null) !== (dto.payGroupId ?? null));
    if (!moving.length) return this.list();
    const inProgress = await Payslip.count({ where: { employeeId: moving.map((e) => e.id) }, include: [{ model: PayrollRun, where: { status: ['DRAFT', 'SUBMITTED'] }, attributes: [] }] });
    if (inProgress) throw AppError.conflict('Some of these people are in a payroll run that is still in progress. Finish or cancel it first.');
    await this.db.transaction(async (transaction) => {
      await Employee.update({ payGroupId: dto.payGroupId ?? null, updatedById: auth.userId }, { where: { id: moving.map((e) => e.id) }, transaction });
      await this.audit.record(
        {
          action: 'payroll.pay_group_assigned',
          entityType: 'PayGroup',
          entityId: dto.payGroupId ?? null,
          summary: `${moving.length} employee${moving.length === 1 ? '' : 's'} moved to ${target ? `pay group "${target.name}"` : 'the main payroll'}`,
          metadata: { employeeIds: moving.map((e) => e.id) },
        },
        transaction,
      );
    });
    return this.list();
  }

  private openRuns(id: string) {
    return PayrollRun.count({ where: { payGroupId: id, status: ['DRAFT', 'SUBMITTED'] } });
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A pay group with this name already exists' }]);
      throw e;
    }
  }
}
