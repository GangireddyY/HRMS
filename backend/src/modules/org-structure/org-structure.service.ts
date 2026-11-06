import { Injectable } from '@nestjs/common';
import { fn, col, UniqueConstraintError, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, Location } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import type {
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateLocationDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateLocationDto,
} from './dto/org-structure.dto';

type StructureKind = 'department' | 'designation' | 'location';

const LABEL: Record<StructureKind, string> = { department: 'Department', designation: 'Designation', location: 'Location' };
const EMPLOYEE_FK: Record<StructureKind, 'departmentId' | 'designationId' | 'locationId'> = {
  department: 'departmentId',
  designation: 'designationId',
  location: 'locationId',
};

/** Departments, designations and locations. Reads are open to every member (they label employee data). */
@Injectable()
export class OrgStructureService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async employeeCounts(kind: StructureKind): Promise<Map<string, number>> {
    const key = EMPLOYEE_FK[kind];
    const rows = (await Employee.findAll({
      attributes: [key, [fn('COUNT', col('id')), 'count']],
      where: { status: ['ACTIVE', 'ON_NOTICE'] },
      group: [key],
      raw: true,
    })) as unknown as Record<string, string>[];
    return new Map(rows.filter((r) => r[key]).map((r) => [r[key]!, Number(r.count)]));
  }

  async listDepartments() {
    const [rows, counts] = await Promise.all([Department.findAll({ order: [['name', 'ASC']] }), this.employeeCounts('department')]);
    const names = new Map(rows.map((r) => [r.id, r.name]));
    return rows.map((r) => ({ ...r.get({ plain: true }), parentName: r.parentId ? (names.get(r.parentId) ?? null) : null, employeeCount: counts.get(r.id) ?? 0 }));
  }

  async listDesignations() {
    const [rows, counts] = await Promise.all([Designation.findAll({ order: [['level', 'ASC NULLS LAST'], ['name', 'ASC']] }), this.employeeCounts('designation')]);
    return rows.map((r) => ({ ...r.get({ plain: true }), employeeCount: counts.get(r.id) ?? 0 }));
  }

  async listLocations() {
    const [rows, counts] = await Promise.all([Location.findAll({ order: [['name', 'ASC']] }), this.employeeCounts('location')]);
    return rows.map((r) => ({ ...r.get({ plain: true }), employeeCount: counts.get(r.id) ?? 0 }));
  }

  async createDepartment(auth: AuthContext, dto: CreateDepartmentDto) {
    if (dto.parentId) await this.requireDepartment(dto.parentId, 'parentId');
    return this.create('department', auth, (transaction) => Department.create({ ...dto, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction }));
  }

  async updateDepartment(auth: AuthContext, id: string, dto: UpdateDepartmentDto) {
    const row = await this.find('department', id);
    if (dto.parentId) {
      await this.requireDepartment(dto.parentId, 'parentId');
      await this.assertNoCycle(id, dto.parentId);
    }
    return this.update('department', auth, row, dto);
  }

  createDesignation(auth: AuthContext, dto: CreateDesignationDto) {
    return this.create('designation', auth, (transaction) => Designation.create({ ...dto, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction }));
  }

  async updateDesignation(auth: AuthContext, id: string, dto: UpdateDesignationDto) {
    return this.update('designation', auth, await this.find('designation', id), dto);
  }

  createLocation(auth: AuthContext, dto: CreateLocationDto) {
    return this.create('location', auth, (transaction) => Location.create({ ...dto, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction }));
  }

  async updateLocation(auth: AuthContext, id: string, dto: UpdateLocationDto) {
    return this.update('location', auth, await this.find('location', id), dto);
  }

  async remove(kind: StructureKind, id: string): Promise<void> {
    const row = await this.find(kind, id);
    const inUse = await Employee.count({ where: { [EMPLOYEE_FK[kind]]: id } });
    if (inUse) throw AppError.conflict(`${LABEL[kind]} is assigned to ${inUse} employee${inUse === 1 ? '' : 's'}. Reassign them or mark it inactive instead.`);
    if (kind === 'department' && (await Department.count({ where: { parentId: id } }))) {
      throw AppError.conflict('Department has sub-departments. Move or delete them first.');
    }
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record({ action: `${kind}.deleted`, entityType: LABEL[kind], entityId: id, summary: `${LABEL[kind]} "${row.get('name') as string}" deleted` }, transaction);
    });
  }

  private model(kind: StructureKind) {
    return { department: Department, designation: Designation, location: Location }[kind] as typeof Department | typeof Designation | typeof Location;
  }

  private async find(kind: StructureKind, id: string) {
    const row = await (this.model(kind) as typeof Department).findByPk(id);
    if (!row) throw AppError.notFound(LABEL[kind]);
    return row;
  }

  private async requireDepartment(id: string, field: string): Promise<void> {
    if (!(await Department.findByPk(id, { attributes: ['id'] }))) throw AppError.validation([{ field, message: 'Department not found' }]);
  }

  /** A department cannot be moved under itself or one of its own sub-departments. */
  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    if (parentId === id) throw AppError.validation([{ field: 'parentId', message: 'A department cannot be its own parent' }]);
    const parents = new Map((await Department.findAll({ attributes: ['id', 'parentId'] })).map((d) => [d.id, d.parentId]));
    for (let cursor: string | null | undefined = parentId, hops = 0; cursor && hops < 1000; cursor = parents.get(cursor), hops++) {
      if (cursor === id) throw AppError.validation([{ field: 'parentId', message: 'A department cannot be moved under its own sub-department' }]);
    }
  }

  private async create<T extends Department | Designation | Location>(kind: StructureKind, _auth: AuthContext, build: (transaction: Transaction) => Promise<T>) {
    try {
      return await this.db.transaction(async (transaction) => {
        const row = await build(transaction);
        await this.audit.record({ action: `${kind}.created`, entityType: LABEL[kind], entityId: row.id, summary: `${LABEL[kind]} "${row.get('name') as string}" created` }, transaction);
        return row;
      });
    } catch (e) {
      throw this.duplicate(kind, e);
    }
  }

  private async update(kind: StructureKind, auth: AuthContext, row: Department | Designation | Location, dto: object) {
    const before = row.get({ plain: true, clone: true }) as Record<string, unknown>;
    try {
      await this.db.transaction(async (transaction) => {
        await (row as Department).update({ ...dto, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: `${kind}.updated`, entityType: LABEL[kind], entityId: row.id, changes: diff(before, dto as Record<string, unknown>) }, transaction);
      });
    } catch (e) {
      throw this.duplicate(kind, e);
    }
    return row;
  }

  private duplicate(kind: StructureKind, e: unknown): unknown {
    if (!(e instanceof UniqueConstraintError)) return e;
    const field = e.errors?.some((x) => x.path?.includes('code')) || String(e.parent?.message ?? '').includes('_code_') ? 'code' : 'name';
    return AppError.validation([{ field, message: `A ${LABEL[kind].toLowerCase()} with this ${field} already exists` }]);
  }
}
