import { Injectable } from '@nestjs/common';
import { ForeignKeyConstraintError, Op, UniqueConstraintError, type Includeable, type Order, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta, resolveSort } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeLifecycleEvent, Location, MembershipRole, OrganizationMembership, Role, Shift, User } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import type { CreateEmployeeDto, EmployeeListQueryDto, LifecycleActionDto, SensitiveDetailsDto, UpdateEmployeeDto, UpdateMyEmployeeDto } from './dto/employees.dto';
import { EmployeeScopeService } from './employee-scope.service';

const PUBLIC_ATTRIBUTES = [
  'id', 'membershipId', 'employeeCode', 'firstName', 'lastName', 'workEmail', 'personalEmail', 'phone', 'dateOfBirth', 'gender',
  'dateOfJoining', 'employmentType', 'status', 'departmentId', 'designationId', 'locationId', 'managerId', 'probationEndDate',
  'exitDate', 'address', 'emergencyContactName', 'emergencyContactPhone', 'bankAccountLast4', 'shiftId', 'createdAt', 'updatedAt',
];

const INCLUDE: Includeable[] = [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
  { model: Location, attributes: ['id', 'name'] },
  { model: Employee, as: 'manager', attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
  { model: Shift, attributes: ['id', 'name'] },
  { model: OrganizationMembership, attributes: ['id', 'status'], include: [{ model: User, attributes: ['email'] }] },
];

const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const today = () => new Date().toISOString().slice(0, 10);

export function toEmployee(e: Employee) {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: fullName(e),
    workEmail: e.workEmail,
    personalEmail: e.personalEmail,
    phone: e.phone,
    dateOfBirth: e.dateOfBirth,
    gender: e.gender,
    dateOfJoining: e.dateOfJoining,
    employmentType: e.employmentType,
    status: e.status,
    probationEndDate: e.probationEndDate,
    exitDate: e.exitDate,
    address: e.address,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    department: ref(e.department),
    designation: ref(e.designation),
    location: ref(e.location),
    shift: ref(e.shift),
    manager: e.manager ? { id: e.manager.id, name: fullName(e.manager), employeeCode: e.manager.employeeCode } : null,
    account: e.membership ? { membershipId: e.membership.id, email: e.membership.user?.email ?? null, status: e.membership.status } : null,
    hasBankAccount: !!e.bankAccountLast4,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly crypto: EncryptionService,
  ) {}

  async list(auth: AuthContext, query: EmployeeListQueryDto) {
    const where = await this.listWhere(auth, query);
    if (!where) return new PaginatedResult([], paginationMeta(query, 0));
    const order = resolveSort<Order>(
      query.sort,
      {
        name: (d) => [['firstName', d], ['lastName', d]],
        employeeCode: (d) => [['employeeCode', d]],
        dateOfJoining: (d) => [['dateOfJoining', d]],
        status: (d) => [['status', d]],
        createdAt: (d) => [['createdAt', d]],
      },
      [['firstName', 'ASC'], ['lastName', 'ASC']],
    );
    const { rows, count } = await Employee.findAndCountAll({ where, attributes: PUBLIC_ATTRIBUTES, include: INCLUDE, order, distinct: true, ...paginationArgs(query) });
    return new PaginatedResult(rows.map(toEmployee), paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const employee = await this.findVisible(auth, 'employee.view', id);
    const reportsWhere = await this.scope.where(auth, 'employee.view');
    const reports = reportsWhere
      ? await Employee.findAll({
          where: { [Op.and]: [{ managerId: id }, reportsWhere] },
          attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'status'],
          include: [{ model: Designation, attributes: ['id', 'name'] }],
          order: [['firstName', 'ASC']],
        })
      : [];
    return {
      ...toEmployee(employee),
      directReports: reports.map((r) => ({ id: r.id, name: fullName(r), employeeCode: r.employeeCode, status: r.status, designation: ref(r.designation) })),
    };
  }

  async me(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return null;
    const employee = await Employee.findByPk(self.id, { attributes: PUBLIC_ATTRIBUTES, include: INCLUDE });
    return employee ? toEmployee(employee) : null;
  }

  async create(auth: AuthContext, dto: CreateEmployeeDto) {
    await this.validateReferences(dto);
    if (dto.membershipId) await this.assertLinkable(dto.membershipId);
    this.assertDates(dto);
    const employee = await this.db.transaction(async (transaction) => {
      const employeeCode = dto.employeeCode ?? (await this.nextEmployeeCode(transaction));
      const created = await this.uniqueGuard(() =>
        Employee.create(
          { ...dto, employeeCode, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        ),
      );
      await EmployeeLifecycleEvent.create(
        { organizationId: auth.organizationId!, employeeId: created.id, type: 'JOINED', effectiveDate: created.dateOfJoining, changes: {}, createdById: auth.userId },
        { transaction },
      );
      await this.audit.record(
        { action: 'employee.created', entityType: 'Employee', entityId: created.id, summary: `Employee ${employeeCode} – ${fullName(created)} created` },
        transaction,
      );
      return created;
    });
    return this.get(auth, employee.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateEmployeeDto) {
    const employee = await this.findVisible(auth, 'employee.update', id);
    if (dto.shiftId) await this.validateReferences({ shiftId: dto.shiftId });
    if (dto.membershipId !== undefined && dto.membershipId !== employee.membershipId && dto.membershipId) await this.assertLinkable(dto.membershipId);
    this.assertDates({ ...employee.get({ plain: true }), ...dto });
    const before = employee.get({ plain: true, clone: true }) as Record<string, unknown>;
    // The employee code is required; an empty value keeps the current one.
    const { employeeCode, ...rest } = dto;
    const values = { ...rest, ...(employeeCode ? { employeeCode } : {}) };
    await this.db.transaction(async (transaction) => {
      await this.uniqueGuard(() => employee.update({ ...values, updatedById: auth.userId }, { transaction }));
      await this.audit.record({ action: 'employee.updated', entityType: 'Employee', entityId: id, changes: diff(before, dto as Record<string, unknown>) }, transaction);
    });
    return this.get(auth, id);
  }

  async updateMe(auth: AuthContext, dto: UpdateMyEmployeeDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record');
    const before = self.get({ plain: true, clone: true }) as Record<string, unknown>;
    await this.db.transaction(async (transaction) => {
      await self.update({ ...dto, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'employee.self_updated', entityType: 'Employee', entityId: self.id, changes: diff(before, dto as Record<string, unknown>) }, transaction);
    });
    return this.me(auth);
  }

  async applyLifecycle(auth: AuthContext, id: string, dto: LifecycleActionDto) {
    const employee = await this.findVisible(auth, 'employee.lifecycle.manage', id);
    if (dto.effectiveDate > today()) {
      throw AppError.validation([{ field: 'effectiveDate', message: 'Future-dated changes are not supported yet; record the change on or after its effective date' }]);
    }
    if (dto.effectiveDate < employee.dateOfJoining) throw AppError.validation([{ field: 'effectiveDate', message: 'Effective date cannot be before the date of joining' }]);
    if (employee.status === 'EXITED' && dto.type !== 'STATUS_CHANGE') throw AppError.conflict('This employee has exited. Change their status first to make other changes.');

    const update: Partial<Employee> = {};
    const has = (k: keyof LifecycleActionDto) => dto[k] !== undefined;
    switch (dto.type) {
      case 'TRANSFER':
        if (!has('departmentId') && !has('locationId')) throw AppError.validation([{ field: 'departmentId', message: 'Choose the new department or location' }]);
        if (has('departmentId')) update.departmentId = dto.departmentId ?? null;
        if (has('locationId')) update.locationId = dto.locationId ?? null;
        break;
      case 'PROMOTION':
        if (!dto.designationId) throw AppError.validation([{ field: 'designationId', message: 'Choose the new designation' }]);
        update.designationId = dto.designationId;
        break;
      case 'MANAGER_CHANGE':
        if (!has('managerId')) throw AppError.validation([{ field: 'managerId', message: 'Choose the new manager (or none)' }]);
        update.managerId = dto.managerId ?? null;
        if (update.managerId) await this.assertNoReportingCycle(id, update.managerId);
        break;
      case 'STATUS_CHANGE':
        if (!dto.status || dto.status === employee.status) throw AppError.validation([{ field: 'status', message: 'Choose a different status' }]);
        update.status = dto.status;
        update.exitDate = dto.status === 'EXITED' ? dto.effectiveDate : null;
        break;
      case 'CONFIRMATION':
        update.probationEndDate = dto.effectiveDate;
        break;
    }
    await this.validateReferences(update);

    const changed = Object.entries(update).filter(([k, v]) => (employee.get(k) ?? null) !== (v ?? null));
    if (!changed.length) throw AppError.validation([{ field: 'type', message: 'Nothing changes with these values' }]);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, to] of changed) changes[field] = { from: await this.label(field, employee.get(field)), to: await this.label(field, to) };

    await this.db.transaction(async (transaction) => {
      await employee.update({ ...update, updatedById: auth.userId }, { transaction });
      await EmployeeLifecycleEvent.create(
        { organizationId: auth.organizationId!, employeeId: id, type: dto.type, effectiveDate: dto.effectiveDate, changes, note: dto.note ?? null, createdById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: `employee.${dto.type.toLowerCase()}`, entityType: 'Employee', entityId: id, summary: `${dto.type.replace('_', ' ').toLowerCase()} for ${fullName(employee)}`, changes }, transaction);
    });
    return this.get(auth, id);
  }

  async history(auth: AuthContext, id: string) {
    await this.findVisible(auth, 'employee.view', id);
    const events = await EmployeeLifecycleEvent.findAll({ where: { employeeId: id }, order: [['effectiveDate', 'DESC'], ['createdAt', 'DESC']] });
    const actorIds = [...new Set(events.map((e) => e.createdById).filter((x): x is string => !!x))];
    const actors = new Map((await User.findAll({ where: { id: actorIds }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      effectiveDate: e.effectiveDate,
      changes: e.changes,
      note: e.note,
      createdAt: e.createdAt,
      createdBy: e.createdById ? (actors.get(e.createdById) ?? null) : null,
    }));
  }

  async getSensitive(auth: AuthContext, id: string) {
    const e = await this.findVisible(auth, 'employee.sensitive.view', id, ['id', 'managerId', 'departmentId', 'panEncrypted', 'uanEncrypted', 'bankAccountEncrypted', 'bankIfsc', 'bankName']);
    await this.audit.record({ action: 'employee.sensitive_viewed', entityType: 'Employee', entityId: id, summary: 'Bank and statutory details viewed' });
    return {
      pan: e.panEncrypted ? this.crypto.decrypt(e.panEncrypted) : null,
      uan: e.uanEncrypted ? this.crypto.decrypt(e.uanEncrypted) : null,
      bankAccountNumber: e.bankAccountEncrypted ? this.crypto.decrypt(e.bankAccountEncrypted) : null,
      bankIfsc: e.bankIfsc,
      bankName: e.bankName,
    };
  }

  async updateSensitive(auth: AuthContext, id: string, dto: SensitiveDetailsDto) {
    const employee = await this.findVisible(auth, 'employee.update', id);
    if (!(await this.scope.covers(auth, 'employee.sensitive.view', employee))) throw AppError.forbidden();
    const enc = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : this.crypto.encrypt(v));
    const values = Object.fromEntries(
      Object.entries({
        panEncrypted: enc(dto.pan),
        uanEncrypted: enc(dto.uan),
        bankAccountEncrypted: enc(dto.bankAccountNumber),
        bankAccountLast4: dto.bankAccountNumber === undefined ? undefined : (dto.bankAccountNumber?.slice(-4) ?? null),
        bankIfsc: dto.bankIfsc,
        bankName: dto.bankName,
      }).filter(([, v]) => v !== undefined),
    );
    await this.db.transaction(async (transaction) => {
      await employee.update({ ...values, updatedById: auth.userId }, { transaction });
      // Values are never written to the audit trail, only which fields changed.
      await this.audit.record({ action: 'employee.sensitive_updated', entityType: 'Employee', entityId: id, metadata: { fields: Object.keys(dto).filter((k) => dto[k as keyof SensitiveDetailsDto] !== undefined) } }, transaction);
    });
    return this.getSensitive(auth, id);
  }

  /**
   * Creates employee records for users who don't have one yet, using their account name and email;
   * the joining date is the day they joined the organization (or were invited). HR completes the rest later.
   */
  async createFromMembers(auth: AuthContext, membershipIds: string[]) {
    const members = await OrganizationMembership.findAll({
      where: { id: membershipIds, status: ['ACTIVE', 'INVITED'] },
      attributes: ['id', 'joinedAt', 'invitedAt', 'createdAt'],
      include: [{ model: User, attributes: ['email', 'firstName', 'lastName'] }],
    });
    const found = new Set(members.map((m) => m.id));
    const missing = membershipIds.filter((id) => !found.has(id));
    if (missing.length) throw AppError.validation([{ field: 'membershipIds', message: `${missing.length} user${missing.length === 1 ? ' was' : 's were'} not found or not active` }]);
    const linked = await Employee.findAll({ where: { membershipId: membershipIds }, attributes: ['membershipId'], raw: true });
    if (linked.length) throw AppError.validation([{ field: 'membershipIds', message: `${linked.length} of these users already ${linked.length === 1 ? 'has' : 'have'} an employee record` }]);

    const created = await this.db.transaction(async (transaction) => {
      const rows: Employee[] = [];
      for (const m of members) {
        const joined = (m.joinedAt ?? m.invitedAt ?? m.createdAt).toISOString().slice(0, 10);
        const employee = await Employee.create(
          {
            organizationId: auth.organizationId!,
            membershipId: m.id,
            employeeCode: await this.nextEmployeeCode(transaction),
            firstName: m.user!.firstName,
            lastName: m.user!.lastName,
            workEmail: m.user!.email,
            dateOfJoining: joined,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        await EmployeeLifecycleEvent.create(
          { organizationId: auth.organizationId!, employeeId: employee.id, type: 'JOINED', effectiveDate: joined, changes: {}, createdById: auth.userId },
          { transaction },
        );
        rows.push(employee);
      }
      await this.audit.record(
        { action: 'employee.created_from_users', entityType: 'Employee', summary: `${rows.length} employee record${rows.length === 1 ? '' : 's'} created from user accounts`, metadata: { employeeIds: rows.map((r) => r.id) } },
        transaction,
      );
      return rows;
    });
    return { created: created.length, employees: created.map((e) => ({ id: e.id, employeeCode: e.employeeCode, fullName: fullName(e), membershipId: e.membershipId })) };
  }

  /** Organization members who can sign in but have no employee record yet. */
  async linkableMembers() {
    const linked = (await Employee.findAll({ where: { membershipId: { [Op.ne]: null } }, attributes: ['membershipId'], raw: true })).map((e) => e.membershipId!);
    const members = await OrganizationMembership.findAll({
      where: { status: ['ACTIVE', 'INVITED'], ...(linked.length ? { id: { [Op.notIn]: linked } } : {}) },
      attributes: ['id', 'status', 'joinedAt', 'invitedAt'],
      include: [
        { model: User, attributes: ['email', 'firstName', 'lastName'] },
        { model: MembershipRole, attributes: ['id'], include: [{ model: Role, attributes: ['name'] }] },
      ],
      order: [[{ model: User, as: 'user' }, 'firstName', 'ASC']],
    });
    return members.map((m) => ({
      membershipId: m.id,
      status: m.status,
      email: m.user!.email,
      firstName: m.user!.firstName,
      lastName: m.user!.lastName,
      joinedAt: m.joinedAt ?? m.invitedAt,
      roles: (m.roles ?? []).map((r) => r.role!.name),
    }));
  }

  async exportCsv(auth: AuthContext, query: EmployeeListQueryDto): Promise<string> {
    const where = await this.listWhere(auth, query);
    const rows = where ? await Employee.findAll({ where, attributes: PUBLIC_ATTRIBUTES, include: INCLUDE, order: [['employeeCode', 'ASC']], limit: 50_000 }) : [];
    const header = ['Employee code', 'First name', 'Last name', 'Work email', 'Phone', 'Status', 'Employment type', 'Date of joining', 'Department', 'Designation', 'Location', 'Manager'];
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formulas (CSV injection).
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) => {
      const e = toEmployee(r);
      return [e.employeeCode, e.firstName, e.lastName, e.workEmail, e.phone, e.status, e.employmentType, e.dateOfJoining, e.department?.name, e.designation?.name, e.location?.name, e.manager?.name].map(cell).join(',');
    });
    await this.audit.record({ action: 'employee.exported', entityType: 'Employee', summary: `${rows.length} employees exported`, metadata: { count: rows.length } });
    return [header.join(','), ...lines].join('\r\n');
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const employee = await this.findVisible(auth, 'employee.view', id);
    const reports = await Employee.count({ where: { managerId: id } });
    if (reports) throw AppError.conflict(`${fullName(employee)} manages ${reports} employee${reports === 1 ? '' : 's'}. Assign them a new manager first.`);
    try {
      await this.db.transaction(async (transaction) => {
        await employee.destroy({ transaction });
        await this.audit.record({ action: 'employee.deleted', entityType: 'Employee', entityId: id, summary: `Employee ${employee.employeeCode} – ${fullName(employee)} deleted` }, transaction);
      });
    } catch (e) {
      if (e instanceof ForeignKeyConstraintError) throw AppError.conflict('This employee has records in other modules. Mark them as exited instead of deleting.');
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------------------

  private async listWhere(auth: AuthContext, query: EmployeeListQueryDto): Promise<WhereOptions | null> {
    const scoped = await this.scope.where(auth, 'employee.view');
    if (!scoped) return null;
    const filters: WhereOptions[] = [scoped];
    for (const key of ['status', 'departmentId', 'designationId', 'locationId', 'managerId', 'employmentType'] as const) {
      if (query[key]) filters.push({ [key]: query[key] });
    }
    if (query.search) {
      const p = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { employeeCode: { [Op.iLike]: p } }, { workEmail: { [Op.iLike]: p } }] });
    }
    return { [Op.and]: filters };
  }

  /** Loads an employee within the caller's scope for `permission`; out-of-scope records are reported as not found. */
  private async findVisible(auth: AuthContext, permission: string, id: string, attributes: string[] = PUBLIC_ATTRIBUTES): Promise<Employee> {
    // organizationId must be loaded: the tenant hooks verify it before any update or delete.
    const required = ['id', 'organizationId', 'managerId', 'departmentId', 'employeeCode', 'firstName', 'lastName', 'dateOfJoining', 'status'];
    const employee = await Employee.findByPk(id, { attributes: [...new Set([...attributes, ...required])], include: attributes === PUBLIC_ATTRIBUTES ? INCLUDE : [] });
    if (!employee || !(await this.scope.covers(auth, 'employee.view', employee))) throw AppError.notFound('Employee');
    if (permission !== 'employee.view' && !(await this.scope.covers(auth, permission, employee))) throw AppError.forbidden();
    return employee;
  }

  private async validateReferences(dto: { departmentId?: string | null; designationId?: string | null; locationId?: string | null; managerId?: string | null; shiftId?: string | null }) {
    const checks: [keyof typeof dto, () => Promise<unknown>][] = [
      ['shiftId', () => Shift.findOne({ where: { id: dto.shiftId!, isActive: true }, attributes: ['id'] })],
      ['departmentId', () => Department.findByPk(dto.departmentId!, { attributes: ['id'] })],
      ['designationId', () => Designation.findByPk(dto.designationId!, { attributes: ['id'] })],
      ['locationId', () => Location.findByPk(dto.locationId!, { attributes: ['id'] })],
      ['managerId', () => Employee.findOne({ where: { id: dto.managerId!, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] })],
    ];
    const issues = [];
    for (const [field, load] of checks) if (dto[field] && !(await load())) issues.push({ field, message: field === 'managerId' ? 'Manager not found or not active' : `${field.replace('Id', '')} not found` });
    if (issues.length) throw AppError.validation(issues);
  }

  private async assertLinkable(membershipId: string) {
    const membership = await OrganizationMembership.findByPk(membershipId, { attributes: ['id', 'status'] });
    if (!membership) throw AppError.validation([{ field: 'membershipId', message: 'User not found in this organization' }]);
    if (await Employee.count({ where: { membershipId } })) throw AppError.validation([{ field: 'membershipId', message: 'This user is already linked to another employee' }]);
  }

  private assertDates(dto: { dateOfBirth?: string | null; dateOfJoining?: string; probationEndDate?: string | null }) {
    const issues = [];
    if (dto.dateOfBirth && dto.dateOfBirth >= today()) issues.push({ field: 'dateOfBirth', message: 'Date of birth must be in the past' });
    if (dto.dateOfBirth && dto.dateOfJoining && dto.dateOfJoining <= dto.dateOfBirth) issues.push({ field: 'dateOfJoining', message: 'Date of joining must be after the date of birth' });
    if (dto.probationEndDate && dto.dateOfJoining && dto.probationEndDate < dto.dateOfJoining) issues.push({ field: 'probationEndDate', message: 'Probation cannot end before the date of joining' });
    if (issues.length) throw AppError.validation(issues);
  }

  /** The new manager must not be the employee or someone who (indirectly) reports to them. */
  private async assertNoReportingCycle(employeeId: string, managerId: string) {
    if (employeeId === managerId) throw AppError.validation([{ field: 'managerId', message: 'An employee cannot be their own manager' }]);
    const managers = new Map((await Employee.findAll({ attributes: ['id', 'managerId'], raw: true })).map((e) => [e.id, e.managerId]));
    for (let cursor: string | null | undefined = managerId, hops = 0; cursor && hops < 10_000; cursor = managers.get(cursor), hops++) {
      if (cursor === employeeId) throw AppError.validation([{ field: 'managerId', message: 'This would create a reporting loop: the new manager reports to this employee' }]);
    }
  }

  private async nextEmployeeCode(transaction: Transaction): Promise<string> {
    const codes = await Employee.findAll({ where: { employeeCode: { [Op.iLike]: 'EMP-%' } }, attributes: ['employeeCode'], raw: true, transaction });
    const max = codes.reduce((m, c) => Math.max(m, Number(/^EMP-(\d+)$/i.exec(c.employeeCode)?.[1] ?? 0)), 0);
    return `EMP-${String(max + 1).padStart(4, '0')}`;
  }

  private async label(field: string, value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'string') return value ?? null;
    if (field === 'departmentId') return (await Department.findByPk(value, { attributes: ['name'] }))?.name ?? value;
    if (field === 'designationId') return (await Designation.findByPk(value, { attributes: ['name'] }))?.name ?? value;
    if (field === 'locationId') return (await Location.findByPk(value, { attributes: ['name'] }))?.name ?? value;
    if (field === 'managerId') {
      const m = await Employee.findByPk(value, { attributes: ['firstName', 'lastName'] });
      return m ? fullName(m) : value;
    }
    return value;
  }

  private async uniqueGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) {
        const detail = String(e.parent?.message ?? '');
        if (detail.includes('membership')) throw AppError.validation([{ field: 'membershipId', message: 'This user is already linked to another employee' }]);
        throw AppError.validation([{ field: 'employeeCode', message: 'An employee with this code already exists' }]);
      }
      throw e;
    }
  }
}

