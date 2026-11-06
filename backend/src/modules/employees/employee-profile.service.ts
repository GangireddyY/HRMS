import { Injectable } from '@nestjs/common';
import type { Order } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Employee, EmployeeEducation, EmployeeExperience, EmployeeFamilyMember } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import type { EducationDto, ExperienceDto, FamilyMemberDto } from './dto/employees.dto';
import { EmployeeScopeService } from './employee-scope.service';

export type ProfileSection = 'family' | 'education' | 'experience';
type SectionDto = { family: FamilyMemberDto; education: EducationDto; experience: ExperienceDto };
type SectionRow = EmployeeFamilyMember | EmployeeEducation | EmployeeExperience;

const MODEL = { family: EmployeeFamilyMember, education: EmployeeEducation, experience: EmployeeExperience } as const;
const LABEL: Record<ProfileSection, string> = { family: 'Family member', education: 'Education entry', experience: 'Previous employment' };
const LIMIT: Record<ProfileSection, number> = { family: 20, education: 20, experience: 30 };
const ORDER: Record<ProfileSection, Order> = {
  family: [['createdAt', 'ASC']],
  education: [['endYear', 'DESC NULLS FIRST'], ['createdAt', 'DESC']],
  experience: [['startDate', 'DESC']],
};
const today = () => new Date().toISOString().slice(0, 10);

const toItem = (row: SectionRow) => {
  const { organizationId: _o, employeeId: _e, createdById: _c, updatedById: _u, ...rest } = row.get({ plain: true }) as Record<string, unknown>;
  return rest;
};

/**
 * Family, education and previous-employment sections of an employee profile.
 * Visible within the caller's employee.view scope; editable by the employee (self.profile.update) or by HR with employee.update in scope.
 */
@Injectable()
export class EmployeeProfileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  async list(auth: AuthContext, employeeId: string, section: ProfileSection) {
    await this.access(auth, employeeId, false);
    const rows = await (MODEL[section] as typeof EmployeeFamilyMember).findAll({ where: { employeeId }, order: ORDER[section] });
    return rows.map(toItem);
  }

  async create<S extends ProfileSection>(auth: AuthContext, employeeId: string, section: S, dto: SectionDto[S]) {
    const employee = await this.access(auth, employeeId, true);
    this.validate(section, dto, employee);
    const model = MODEL[section] as typeof EmployeeFamilyMember;
    if ((await model.count({ where: { employeeId } })) >= LIMIT[section]) throw AppError.conflict(`Up to ${LIMIT[section]} entries can be added here`);
    const row = await this.db.transaction(async (transaction) => {
      const created = await model.create(
        { ...(dto as FamilyMemberDto), organizationId: auth.organizationId!, employeeId, createdById: auth.userId, updatedById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: `employee.${section}_added`, entityType: 'Employee', entityId: employeeId, summary: `${LABEL[section]} added` }, transaction);
      return created;
    });
    return toItem(row);
  }

  async update<S extends ProfileSection>(auth: AuthContext, employeeId: string, section: S, id: string, dto: SectionDto[S]) {
    const employee = await this.access(auth, employeeId, true);
    const row = await this.find(section, employeeId, id);
    const merged = { ...(row.get({ plain: true }) as object), ...dto } as SectionDto[S];
    this.validate(section, merged, employee);
    const before = row.get({ plain: true, clone: true }) as Record<string, unknown>;
    await this.db.transaction(async (transaction) => {
      await (row as EmployeeFamilyMember).update({ ...(dto as FamilyMemberDto), updatedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: `employee.${section}_updated`, entityType: 'Employee', entityId: employeeId, summary: `${LABEL[section]} updated`, changes: diff(before, dto as unknown as Record<string, unknown>) },
        transaction,
      );
    });
    return toItem(row);
  }

  async remove(auth: AuthContext, employeeId: string, section: ProfileSection, id: string): Promise<void> {
    await this.access(auth, employeeId, true);
    const row = await this.find(section, employeeId, id);
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record({ action: `employee.${section}_removed`, entityType: 'Employee', entityId: employeeId, summary: `${LABEL[section]} removed` }, transaction);
    });
  }

  private async access(auth: AuthContext, employeeId: string, write: boolean): Promise<Employee> {
    const employee = await Employee.findByPk(employeeId, { attributes: ['id', 'organizationId', 'managerId', 'departmentId', 'dateOfJoining', 'dateOfBirth'] });
    if (!employee || !(await this.scope.covers(auth, 'employee.view', employee))) throw AppError.notFound('Employee');
    if (write) {
      const self = await this.scope.self(auth);
      const ownRecord = self?.id === employee.id && auth.permissions.has('self.profile.update');
      if (!ownRecord && !(await this.scope.covers(auth, 'employee.update', employee))) throw AppError.forbidden();
    }
    return employee;
  }

  private async find(section: ProfileSection, employeeId: string, id: string): Promise<SectionRow> {
    const row = await (MODEL[section] as typeof EmployeeFamilyMember).findOne({ where: { id, employeeId } });
    if (!row) throw AppError.notFound(LABEL[section]);
    return row;
  }

  private validate<S extends ProfileSection>(section: S, dto: SectionDto[S], employee: Employee): void {
    const issues: { field: string; message: string }[] = [];
    if (section === 'family') {
      const d = dto as FamilyMemberDto;
      if (d.dateOfBirth && d.dateOfBirth > today()) issues.push({ field: 'dateOfBirth', message: 'Date of birth cannot be in the future' });
    } else if (section === 'education') {
      const d = dto as EducationDto;
      if (d.startYear && d.endYear && d.endYear < d.startYear) issues.push({ field: 'endYear', message: 'The end year cannot be before the start year' });
      if (d.startYear && d.startYear > new Date().getFullYear()) issues.push({ field: 'startYear', message: 'The start year cannot be in the future' });
    } else {
      const d = dto as ExperienceDto;
      if (d.endDate < d.startDate) issues.push({ field: 'endDate', message: 'The end date cannot be before the start date' });
      if (d.endDate > today()) issues.push({ field: 'endDate', message: 'The end date cannot be in the future' });
      if (d.startDate >= employee.dateOfJoining) issues.push({ field: 'startDate', message: 'Previous employment must start before joining this organization' });
      if (employee.dateOfBirth && d.startDate <= employee.dateOfBirth) issues.push({ field: 'startDate', message: 'The start date must be after the date of birth' });
    }
    if (issues.length) throw AppError.validation(issues);
  }
}
