import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import type { DelegatedGrant, PermissionScope } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { Employee } from '../../database/models';

/** The caller's own employee record, looked up once per request. */
const selfCache = new WeakMap<AuthContext, Promise<Employee | null>>();

type Covered = Pick<Employee, 'id' | 'managerId' | 'departmentId'>;
const BROAD: PermissionScope[] = ['DEPARTMENT', 'ORGANIZATION'];

/**
 * Record-level scope for employee data (and data owned by employees, e.g. attendance and leave):
 *  OWN          → the caller's own employee record
 *  TEAM         → own record + direct reports (manager_id = caller)
 *  DEPARTMENT   → own record + everyone in the caller's department
 *  ORGANIZATION → everyone
 * A caller without an employee record only gets ORGANIZATION-scoped access.
 *
 * Approvals delegated to the caller (AuthContext.delegated) add the delegator's reach — the delegator's team or
 * department, never the delegator's own record.
 */
@Injectable()
export class EmployeeScopeService {
  self(auth: AuthContext): Promise<Employee | null> {
    if (!auth.membershipId) return Promise.resolve(null);
    let cached = selfCache.get(auth);
    if (!cached) {
      cached = Employee.findOne({ where: { membershipId: auth.membershipId } });
      selfCache.set(auth, cached);
    }
    return cached;
  }

  scopeOf(auth: AuthContext, permission: string): PermissionScope | null {
    return auth.permissions.get(permission) ?? null;
  }

  /** WHERE clause on employees for the permission, or `null` when nothing is visible. Combine with AND. */
  async where(auth: AuthContext, permission: string, idField = 'id'): Promise<WhereOptions | null> {
    const clauses: WhereOptions[] = [];
    const scope = this.scopeOf(auth, permission);
    if (scope === 'ORGANIZATION') return {};
    if (scope) {
      const self = await this.self(auth);
      if (self) clauses.push(scope === 'OWN' ? { [idField]: self.id } : { [idField]: { [Op.in]: await this.visibleIds(scope, self) } });
    }
    for (const grant of this.grants(auth, permission)) {
      if (grant.scope === 'ORGANIZATION') return {};
      const ids = await this.delegatedIds(grant);
      if (ids.length) clauses.push({ [idField]: { [Op.in]: ids } });
    }
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0]! : { [Op.or]: clauses };
  }

  /** Whether the employee is within the caller's scope for the permission. */
  async covers(auth: AuthContext, permission: string, employee: Covered): Promise<boolean> {
    if (await this.ownCovers(auth, this.scopeOf(auth, permission), employee)) return true;
    return this.grants(auth, permission).some((g) => this.grantCovers(g, employee));
  }

  /**
   * Covers the employee with department- or organization-wide reach (own or delegated) — e.g. HR for a second
   * approval level, as opposed to the direct manager.
   */
  async coversBroadly(auth: AuthContext, permission: string, employee: Covered): Promise<boolean> {
    const scope = this.scopeOf(auth, permission);
    if (scope && BROAD.includes(scope) && (await this.ownCovers(auth, scope, employee))) return true;
    return this.grants(auth, permission).some((g) => BROAD.includes(g.scope) && this.grantCovers(g, employee));
  }

  /** The people the caller approves for on someone else's behalf, by delegator name (for "on behalf of" labels). */
  delegatedBy(auth: AuthContext, permission: string, employee: Covered): string | null {
    if (this.scopeOf(auth, permission) === 'ORGANIZATION') return null;
    return this.grants(auth, permission).find((g) => this.grantCovers(g, employee))?.delegatorName ?? null;
  }

  private grants(auth: AuthContext, permission: string): DelegatedGrant[] {
    return (auth.delegated ?? []).filter((g) => g.permission === permission);
  }

  private async ownCovers(auth: AuthContext, scope: PermissionScope | null, employee: Covered): Promise<boolean> {
    if (!scope) return false;
    if (scope === 'ORGANIZATION') return true;
    const self = await this.self(auth);
    if (!self) return false;
    if (employee.id === self.id) return true;
    if (scope === 'TEAM') return employee.managerId === self.id;
    if (scope === 'DEPARTMENT') return !!self.departmentId && employee.departmentId === self.departmentId;
    return false;
  }

  private grantCovers(g: DelegatedGrant, employee: Covered): boolean {
    if (employee.id === g.delegatorEmployeeId) return false;
    if (g.scope === 'ORGANIZATION') return true;
    if (g.scope === 'TEAM') return !!g.delegatorEmployeeId && employee.managerId === g.delegatorEmployeeId;
    if (g.scope === 'DEPARTMENT') return !!g.delegatorDepartmentId && employee.departmentId === g.delegatorDepartmentId;
    return false;
  }

  private async visibleIds(scope: 'TEAM' | 'DEPARTMENT', self: Employee): Promise<string[]> {
    const where = scope === 'TEAM' ? { managerId: self.id } : self.departmentId ? { departmentId: self.departmentId } : { id: self.id };
    const rows = await Employee.findAll({ where, attributes: ['id'], raw: true });
    return [...new Set([self.id, ...rows.map((r) => r.id)])];
  }

  private async delegatedIds(g: DelegatedGrant): Promise<string[]> {
    const where =
      g.scope === 'TEAM' && g.delegatorEmployeeId ? { managerId: g.delegatorEmployeeId } : g.scope === 'DEPARTMENT' && g.delegatorDepartmentId ? { departmentId: g.delegatorDepartmentId } : null;
    if (!where) return [];
    const rows = await Employee.findAll({ where, attributes: ['id'], raw: true });
    return rows.map((r) => r.id).filter((id) => id !== g.delegatorEmployeeId);
  }
}
