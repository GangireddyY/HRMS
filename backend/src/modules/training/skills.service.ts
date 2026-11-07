import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { MATRIX_MAX_SKILLS, MAX_SKILLS_PER_ROLE } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, DesignationSkill, Employee, EmployeeSkill, Skill, TrainingCourse, TrainingCourseSkill, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import type { CourseSkillsDto, MatrixQueryDto, MySkillDto, RequirementsDto, SkillDto, SkillQueryDto, VerifySkillDto } from './dto/training.dto';
import { effectiveLevel, readiness, skillGaps } from './skill-rules';

const PERSON = ['id', 'employeeCode', 'firstName', 'lastName', 'designationId', 'departmentId', 'managerId', 'membershipId', 'status'];

/**
 * Skill matrix. `training.manage` keeps the skills catalog, the skills each designation needs and the skills courses
 * teach. Employees rate their own skills (`training.view`); managers within `training.assign` scope (and
 * `training.manage`) verify levels — never their own — and see the matrix of the people in scope. Completing a course
 * verifies the skills it teaches. Gaps against the designation's needs suggest published courses that close them.
 */
@Injectable()
export class SkillsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  // ---- Catalog ----------------------------------------------------------------------------------

  async list(auth: AuthContext, query: SkillQueryDto) {
    const where: WhereOptions[] = [];
    if (!query.includeInactive || !auth.permissions.has('training.manage')) where.push({ isActive: true });
    if (query.category) where.push({ category: query.category });
    if (query.search) where.push({ name: { [Op.iLike]: containsPattern(query.search) } });
    const rows = await Skill.findAll({ where: { [Op.and]: where }, order: [['category', 'ASC'], ['name', 'ASC']] });
    const counts = new Map<string, number>();
    if (auth.permissions.has('training.manage') && rows.length) {
      for (const r of await EmployeeSkill.findAll({ where: { skillId: rows.map((s) => s.id) }, attributes: ['skillId'], raw: true })) counts.set(r.skillId, (counts.get(r.skillId) ?? 0) + 1);
    }
    return rows.map((s) => ({ id: s.id, name: s.name, category: s.category, description: s.description, isActive: s.isActive, ...(auth.permissions.has('training.manage') ? { people: counts.get(s.id) ?? 0 } : {}) }));
  }

  async create(auth: AuthContext, dto: SkillDto) {
    const s = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const created = await Skill.create({ organizationId: auth.organizationId!, name: dto.name, category: dto.category, description: dto.description ?? null, isActive: dto.isActive ?? true, createdById: auth.userId }, { transaction });
        await this.audit.record({ action: 'skill.created', entityType: 'Skill', entityId: created.id, summary: `Skill "${created.name}" added` }, transaction);
        return created;
      }),
    );
    return { id: s.id, name: s.name, category: s.category, description: s.description, isActive: s.isActive, people: 0 };
  }

  async update(auth: AuthContext, id: string, dto: Partial<SkillDto>) {
    const s = await Skill.findByPk(id);
    if (!s) throw AppError.notFound('Skill');
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        await s.update({ ...(dto.name ? { name: dto.name } : {}), ...(dto.category ? { category: dto.category } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) }, { transaction });
        await this.audit.record({ action: 'skill.updated', entityType: 'Skill', entityId: id, summary: `Skill "${s.name}" updated` }, transaction);
      }),
    );
    return { id: s.id, name: s.name, category: s.category, description: s.description, isActive: s.isActive };
  }

  async remove(id: string) {
    const s = await Skill.findByPk(id);
    if (!s) throw AppError.notFound('Skill');
    const used = (await EmployeeSkill.count({ where: { skillId: id } })) + (await DesignationSkill.count({ where: { skillId: id } })) + (await TrainingCourseSkill.count({ where: { skillId: id } }));
    if (used) throw AppError.conflict('This skill is in use (people, roles or courses). Deactivate it instead.');
    await this.db.transaction(async (transaction) => {
      await s.destroy({ transaction });
      await this.audit.record({ action: 'skill.deleted', entityType: 'Skill', entityId: id, summary: `Skill "${s.name}" deleted` }, transaction);
    });
  }

  // ---- Role requirements & course skills -------------------------------------------------------

  async requirements(designationId?: string) {
    const rows = await DesignationSkill.findAll({ where: designationId ? { designationId } : {}, include: [{ model: Skill, attributes: ['id', 'name', 'category', 'isActive'] }] });
    const designations = await Designation.findAll({ where: designationId ? { id: designationId } : {}, attributes: ['id', 'name'], order: [['name', 'ASC']] });
    return designations.map((d) => ({
      designation: { id: d.id, name: d.name },
      skills: rows
        .filter((r) => r.designationId === d.id)
        .map((r) => ({ skillId: r.skillId, name: r.skill?.name ?? '', category: r.skill?.category, requiredLevel: r.requiredLevel }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  async setRequirements(auth: AuthContext, designationId: string, dto: RequirementsDto) {
    const designation = await Designation.findByPk(designationId, { attributes: ['id', 'name'] });
    if (!designation) throw AppError.notFound('Designation');
    if (dto.skills.length > MAX_SKILLS_PER_ROLE) throw AppError.validation([{ field: 'skills', message: `A role can need at most ${MAX_SKILLS_PER_ROLE} skills` }]);
    await this.checkSkills(dto.skills.map((s) => s.skillId));
    await this.db.transaction(async (transaction) => {
      await DesignationSkill.destroy({ where: { designationId }, transaction });
      if (dto.skills.length) await DesignationSkill.bulkCreate(dto.skills.map((s) => ({ organizationId: auth.organizationId!, designationId, skillId: s.skillId, requiredLevel: s.level })), { transaction });
      await this.audit.record({ action: 'skill.requirements_set', entityType: 'Designation', entityId: designationId, summary: `${dto.skills.length} skill${dto.skills.length === 1 ? '' : 's'} required for ${designation.name}` }, transaction);
    });
    return (await this.requirements(designationId))[0];
  }

  async courseSkills(courseId: string) {
    const rows = await TrainingCourseSkill.findAll({ where: { courseId }, include: [{ model: Skill, attributes: ['id', 'name', 'category'] }] });
    return rows.map((r) => ({ skillId: r.skillId, name: r.skill?.name ?? '', category: r.skill?.category, level: r.level })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async setCourseSkills(auth: AuthContext, courseId: string, dto: CourseSkillsDto) {
    const course = await TrainingCourse.findByPk(courseId, { attributes: ['id', 'title'] });
    if (!course) throw AppError.notFound('Course');
    await this.checkSkills(dto.skills.map((s) => s.skillId));
    await this.db.transaction(async (transaction) => {
      await TrainingCourseSkill.destroy({ where: { courseId }, transaction });
      if (dto.skills.length) await TrainingCourseSkill.bulkCreate(dto.skills.map((s) => ({ organizationId: auth.organizationId!, courseId, skillId: s.skillId, level: s.level })), { transaction });
      await this.audit.record({ action: 'training.course_skills_set', entityType: 'TrainingCourse', entityId: courseId, summary: `"${course.title}" teaches ${dto.skills.length} skill${dto.skills.length === 1 ? '' : 's'}` }, transaction);
    });
    return this.courseSkills(courseId);
  }

  // ---- People -----------------------------------------------------------------------------------

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return null;
    return this.profile(auth, self, true);
  }

  async setMine(auth: AuthContext, dto: MySkillDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees have skills');
    const skill = await Skill.findByPk(dto.skillId, { attributes: ['id', 'name', 'isActive'] });
    if (!skill || !skill.isActive) throw AppError.validation([{ field: 'skillId', message: 'Choose a skill from the catalog' }]);
    const existing = await EmployeeSkill.findOne({ where: { employeeId: self.id, skillId: skill.id } });
    if (existing) await existing.update({ level: dto.level, notes: dto.notes ?? existing.notes });
    else await EmployeeSkill.create({ organizationId: self.organizationId, employeeId: self.id, skillId: skill.id, level: dto.level, notes: dto.notes ?? null });
    return this.profile(auth, self, true);
  }

  /** Removes the employee's own rating; verified levels stay. */
  async removeMine(auth: AuthContext, skillId: string) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees have skills');
    const existing = await EmployeeSkill.findOne({ where: { employeeId: self.id, skillId } });
    if (!existing) throw AppError.notFound('Skill');
    if (existing.verifiedLevel) await existing.update({ level: null });
    else await existing.destroy();
    return this.profile(auth, self, true);
  }

  async employee(auth: AuthContext, employeeId: string) {
    const e = await this.covered(auth, employeeId);
    return this.profile(auth, e, false);
  }

  async verify(auth: AuthContext, employeeId: string, skillId: string, dto: VerifySkillDto) {
    const e = await this.covered(auth, employeeId);
    if (e.membershipId && e.membershipId === auth.membershipId) throw AppError.forbidden("You can't verify your own skills");
    const skill = await Skill.findByPk(skillId, { attributes: ['id', 'name'] });
    if (!skill) throw AppError.notFound('Skill');
    await this.db.transaction(async (transaction) => {
      const existing = await EmployeeSkill.findOne({ where: { employeeId, skillId }, transaction });
      const values = { verifiedLevel: dto.level, verifiedSource: 'MANAGER' as const, verifiedById: auth.userId, verifiedAt: new Date() };
      if (existing) await existing.update(values, { transaction });
      else await EmployeeSkill.create({ organizationId: e.organizationId, employeeId, skillId, ...values }, { transaction });
      await this.audit.record({ action: 'skill.verified', entityType: 'Employee', entityId: employeeId, summary: `${skill.name} of ${e.employeeCode} verified at level ${dto.level}` }, transaction);
    });
    return this.profile(auth, e, false);
  }

  /** People in scope × skills: the skills asked for, those the role filter needs, or the most common ones. */
  async matrix(auth: AuthContext, query: MatrixQueryDto) {
    const manage = auth.permissions.has('training.manage');
    if (!manage && (this.scope.scopeOf(auth, 'training.assign') ?? 'OWN') === 'OWN') throw AppError.forbidden();
    const scoped = manage ? {} : await this.scope.where(auth, 'training.assign');
    let skillIds = query.skillIds ?? [];
    if (!skillIds.length && query.designationId) skillIds = (await DesignationSkill.findAll({ where: { designationId: query.designationId }, attributes: ['skillId'], raw: true })).map((r) => r.skillId);
    const conditions: WhereOptions[] = [scoped ?? { id: null }, { status: ['ACTIVE', 'ON_NOTICE'] }];
    if (query.departmentId) conditions.push({ departmentId: query.departmentId });
    if (query.designationId) conditions.push({ designationId: query.designationId });
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] });
    }
    const where = { [Op.and]: conditions };
    const allIds = (await Employee.findAll({ where, attributes: ['id'], raw: true })).map((e) => e.id);
    if (!skillIds.length && allIds.length) {
      const counts = new Map<string, number>();
      for (const r of await EmployeeSkill.findAll({ where: { employeeId: allIds }, attributes: ['skillId'], raw: true })) counts.set(r.skillId, (counts.get(r.skillId) ?? 0) + 1);
      skillIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MATRIX_MAX_SKILLS).map(([id]) => id);
    }
    skillIds = skillIds.slice(0, MATRIX_MAX_SKILLS);
    const skills = skillIds.length ? await Skill.findAll({ where: { id: skillIds }, attributes: ['id', 'name', 'category'] }) : [];
    const ordered = skillIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is Skill => !!s);
    const employees = await Employee.findAll({
      where,
      attributes: PERSON,
      include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const ids = employees.map((e) => e.id);
    const designationIds = [...new Set(employees.map((e) => e.designationId).filter((x): x is string => !!x))];
    const [levels, needs, allLevels] = await Promise.all([
      ids.length && skillIds.length ? EmployeeSkill.findAll({ where: { employeeId: ids, skillId: skillIds } }) : [],
      designationIds.length && skillIds.length ? DesignationSkill.findAll({ where: { designationId: designationIds, skillId: skillIds } }) : [],
      allIds.length && skillIds.length ? EmployeeSkill.findAll({ where: { employeeId: allIds, skillId: skillIds }, attributes: ['skillId', 'level', 'verifiedLevel'] }) : [],
    ]);
    const rows = employees.map((e) => ({
      employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null },
      cells: ordered.map((s) => {
        const mine = levels.find((l) => l.employeeId === e.id && l.skillId === s.id);
        const need = needs.find((n) => n.designationId === e.designationId && n.skillId === s.id);
        const level = effectiveLevel(mine);
        return { skillId: s.id, level, selfLevel: mine?.level ?? null, verifiedLevel: mine?.verifiedLevel ?? null, required: need?.requiredLevel ?? null, gap: need ? Math.max(0, need.requiredLevel - level) : 0 };
      }),
    }));
    const summary = ordered.map((s) => {
      const held = allLevels.filter((l) => l.skillId === s.id).map(effectiveLevel).filter((v) => v > 0);
      return { skillId: s.id, people: held.length, advanced: held.filter((v) => v >= 4).length, average: held.length ? Math.round((held.reduce((a, b) => a + b, 0) / held.length) * 10) / 10 : null };
    });
    return { skills: ordered.map((s) => ({ id: s.id, name: s.name, category: s.category })), summary, page: new PaginatedResult(rows, paginationMeta(query, allIds.length)) };
  }

  // ---- Internals --------------------------------------------------------------------------------

  /** An employee's skills, what their designation needs, gaps and courses that close them. */
  private async profile(auth: AuthContext, e: Employee, self: boolean) {
    const [rows, needs, designation] = await Promise.all([
      EmployeeSkill.findAll({ where: { employeeId: e.id }, include: [{ model: Skill, attributes: ['id', 'name', 'category', 'isActive'] }] }),
      e.designationId ? DesignationSkill.findAll({ where: { designationId: e.designationId }, include: [{ model: Skill, attributes: ['id', 'name', 'category'] }] }) : [],
      e.designationId ? Designation.findByPk(e.designationId, { attributes: ['id', 'name'] }) : null,
    ]);
    const levels = new Map(rows.map((r) => [r.skillId, effectiveLevel(r)]));
    const gaps = skillGaps(needs.map((n) => ({ skillId: n.skillId, requiredLevel: n.requiredLevel })), levels);
    const courses = gaps.length
      ? await TrainingCourseSkill.findAll({
          where: { skillId: gaps.map((g) => g.skillId) },
          include: [{ model: TrainingCourse, attributes: ['id', 'code', 'title', 'delivery', 'status', 'durationHours'], where: { status: 'PUBLISHED' } }],
        })
      : [];
    const verifiers = await this.names(rows.map((r) => r.verifiedById));
    const name = (id: string) => rows.find((r) => r.skillId === id)?.skill?.name ?? needs.find((n) => n.skillId === id)?.skill?.name ?? '';
    const coveredByVerify = !self && (auth.permissions.has('training.manage') || (await this.scope.covers(auth, 'training.assign', e))) && e.membershipId !== auth.membershipId;
    return {
      employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode },
      designation: designation ? { id: designation.id, name: designation.name } : null,
      skills: rows
        .map((r) => ({
          skillId: r.skillId,
          name: r.skill?.name ?? '',
          category: r.skill?.category,
          level: r.level,
          verifiedLevel: r.verifiedLevel,
          verifiedSource: r.verifiedSource,
          verifiedBy: r.verifiedById ? (verifiers.get(r.verifiedById) ?? 'Former user') : null,
          verifiedAt: r.verifiedAt,
          effectiveLevel: effectiveLevel(r),
          notes: r.notes,
          required: needs.find((n) => n.skillId === r.skillId)?.requiredLevel ?? null,
        }))
        .sort((a, b) => b.effectiveLevel - a.effectiveLevel || a.name.localeCompare(b.name)),
      requirements: needs.map((n) => ({ skillId: n.skillId, name: n.skill?.name ?? '', category: n.skill?.category, requiredLevel: n.requiredLevel, current: levels.get(n.skillId) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name)),
      readiness: readiness(needs.map((n) => ({ skillId: n.skillId, requiredLevel: n.requiredLevel })), levels),
      gaps: gaps.map((g) => ({
        ...g,
        name: name(g.skillId),
        courses: courses
          .filter((c) => c.skillId === g.skillId && c.level > g.current)
          .map((c) => ({ id: c.course!.id, code: c.course!.code, title: c.course!.title, delivery: c.course!.delivery, teachesLevel: c.level, durationHours: c.course!.durationHours === null ? null : Number(c.course!.durationHours) })),
      })),
      permissions: { edit: self, verify: coveredByVerify },
    };
  }

  /** An employee within `training.assign` scope (or anyone with `training.manage`). */
  private async covered(auth: AuthContext, employeeId: string) {
    const e = await Employee.findByPk(employeeId, { attributes: [...PERSON, 'organizationId'] });
    if (!e) throw AppError.notFound('Employee');
    const ok = auth.permissions.has('training.manage') || (await this.scope.covers(auth, 'training.assign', e));
    if (!ok) throw AppError.notFound('Employee');
    return e;
  }

  private async checkSkills(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw AppError.validation([{ field: 'skills', message: 'Each skill can be listed once' }]);
    if (ids.length && (await Skill.count({ where: { id: ids } })) !== ids.length) throw AppError.validation([{ field: 'skills', message: 'Choose skills from the catalog' }]);
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A skill with this name already exists' }]);
      throw e;
    }
  }
}
