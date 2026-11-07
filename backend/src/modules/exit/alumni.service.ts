import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { AlumniProfile, Department, Designation, Employee, ExitCase } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import type { AlumniProfileDto, AlumniQueryDto } from './dto/exit.dto';

/**
 * Alumni: everyone who has exited. Former employees can join the alumni network (`exit.resign`) with their personal
 * contact details, current job and whether they are open to opportunities; HR sees those details only while they are
 * opted in. The directory is for `exit.manage` (everyone, with rehire eligibility) and `exit.view` at team scope or
 * wider (in scope).
 */
@Injectable()
export class AlumniService {
  constructor(
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { eligible: false, profile: null };
    const profile = await AlumniProfile.findOne({ where: { employeeId: self.id } });
    return {
      eligible: self.status === 'EXITED',
      profile: profile
        ? this.profile(profile)
        : { optedIn: false, personalEmail: self.personalEmail, phone: self.phone, linkedinUrl: null, currentCompany: null, currentTitle: null, city: null, openToOpportunities: false, updatedAt: null },
      joined: !!profile,
    };
  }

  async updateMine(auth: AuthContext, dto: AlumniProfileDto) {
    const self = await this.scope.self(auth);
    if (!self || self.status !== 'EXITED') throw AppError.conflict('The alumni network is open to former employees');
    const values = {
      optedIn: dto.optedIn,
      personalEmail: dto.personalEmail ?? null,
      phone: dto.phone ?? null,
      linkedinUrl: dto.linkedinUrl ?? null,
      currentCompany: dto.currentCompany ?? null,
      currentTitle: dto.currentTitle ?? null,
      city: dto.city ?? null,
      openToOpportunities: dto.optedIn && !!dto.openToOpportunities,
    };
    const existing = await AlumniProfile.findOne({ where: { employeeId: self.id } });
    if (existing) await existing.update(values);
    else await AlumniProfile.create({ organizationId: self.organizationId, employeeId: self.id, ...values });
    await this.audit.record({ action: dto.optedIn ? 'alumni.joined' : 'alumni.opted_out', entityType: 'Employee', entityId: self.id, summary: `${self.employeeCode} ${dto.optedIn ? 'updated their alumni profile' : 'opted out of the alumni network'}` });
    return this.mine(auth);
  }

  async list(auth: AuthContext, query: AlumniQueryDto) {
    const manage = auth.permissions.has('exit.manage');
    if (!manage && (this.scope.scopeOf(auth, 'exit.view') ?? 'OWN') === 'OWN') throw AppError.forbidden();
    const scoped = manage ? {} : await this.scope.where(auth, 'exit.view');
    if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
    const conditions: WhereOptions[] = [scoped, { status: 'EXITED' }];
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] });
    }
    if (query.rehire && manage) {
      const eligibleForRehire = query.rehire === 'yes' ? true : query.rehire === 'no' ? false : null;
      const ids = (await ExitCase.findAll({ where: { status: 'COMPLETED', eligibleForRehire }, attributes: ['employeeId'], raw: true })).map((c) => c.employeeId);
      conditions.push({ id: { [Op.in]: ids } });
    }
    if (query.optedIn || query.openToOpportunities) {
      const where = { optedIn: true, ...(query.openToOpportunities ? { openToOpportunities: true } : {}) };
      conditions.push({ id: { [Op.in]: (await AlumniProfile.findAll({ where, attributes: ['employeeId'], raw: true })).map((p) => p.employeeId) } });
    }
    const where = { [Op.and]: conditions };
    const count = await Employee.count({ where });
    const rows = await Employee.findAll({
      where,
      attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'dateOfJoining', 'exitDate'],
      include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }],
      order: [['exitDate', 'DESC NULLS LAST'], ['firstName', 'ASC']],
      ...paginationArgs(query),
    });
    const ids = rows.map((r) => r.id);
    const [cases, profiles] = ids.length
      ? await Promise.all([
          ExitCase.findAll({ where: { employeeId: ids, status: 'COMPLETED' }, order: [['completedAt', 'DESC']] }),
          AlumniProfile.findAll({ where: { employeeId: ids } }),
        ])
      : [[], []];
    return new PaginatedResult(
      rows.map((e) => {
        const c = cases.find((x) => x.employeeId === e.id);
        const p = profiles.find((x) => x.employeeId === e.id);
        return {
          id: e.id,
          name: fullName(e),
          employeeCode: e.employeeCode,
          department: e.department?.name ?? null,
          designation: e.designation?.name ?? null,
          dateOfJoining: e.dateOfJoining,
          exitDate: e.exitDate,
          exit: c ? { id: c.id, type: c.type, reason: c.reason, lastWorkingDay: c.lastWorkingDay, ...(manage ? { eligibleForRehire: c.eligibleForRehire } : {}) } : null,
          optedIn: !!p?.optedIn,
          alumni: p?.optedIn ? this.profile(p) : null,
        };
      }),
      paginationMeta(query, count),
    );
  }

  private profile(p: AlumniProfile) {
    return {
      optedIn: p.optedIn,
      personalEmail: p.personalEmail,
      phone: p.phone,
      linkedinUrl: p.linkedinUrl,
      currentCompany: p.currentCompany,
      currentTitle: p.currentTitle,
      city: p.city,
      openToOpportunities: p.openToOpportunities,
      updatedAt: p.updatedAt,
    };
  }
}
