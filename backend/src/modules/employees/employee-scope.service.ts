import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import type { PermissionScope } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { Employee } from '../../database/models';

/** The caller's own employee record, looked up once per request. */
const selfCache = new WeakMap<AuthContext, Promise<Employee | null>>();

/**
 * Record-level scope for employee data (and data owned by employees, e.g. attendance and leave):
 *  OWN          → the caller's own employee record
 *  TEAM         → own record + direct reports (manager_id = caller)
 *  DEPARTMENT   → own record + everyone in the caller's department
 *  ORGANIZATION → everyone
 * A caller without an employee record only gets ORGANIZATION-scoped access.
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
    const scope = this.scopeOf(auth, permission);
    if (!scope) return null;
    if (scope === 'ORGANIZATION') return {};
    const self = await this.self(auth);
    if (!self) return null;
    if (scope === 'OWN') return { [idField]: self.id };
    const ids = await this.visibleIds(scope, self);
    return { [idField]: { [Op.in]: ids } };
  }

  /** Whether the employee is within the caller's scope for the permission. */
  async covers(auth: AuthContext, permission: string, employee: Pick<Employee, 'id' | 'managerId' | 'departmentId'>): Promise<boolean> {
    const scope = this.scopeOf(auth, permission);
    if (!scope) return false;
    if (scope === 'ORGANIZATION') return true;
    const self = await this.self(auth);
    if (!self) return false;
    if (employee.id === self.id) return true;
    if (scope === 'TEAM') return employee.managerId === self.id;
    if (scope === 'DEPARTMENT') return !!self.departmentId && employee.departmentId === self.departmentId;
    return false;
  }

  private async visibleIds(scope: 'TEAM' | 'DEPARTMENT', self: Employee): Promise<string[]> {
    const where = scope === 'TEAM' ? { managerId: self.id } : self.departmentId ? { departmentId: self.departmentId } : { id: self.id };
    const rows = await Employee.findAll({ where, attributes: ['id'], raw: true });
    return [...new Set([self.id, ...rows.map((r) => r.id)])];
  }
}
