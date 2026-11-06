import { Op, type Transaction } from 'sequelize';
import { zonedParts } from '../../common/utils/zoned-time';
import { Employee, MembershipRole, Organization, OrganizationMembership, Permission, RolePermission } from '../../database/models';

export const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
export const personRef = (e: Employee | null | undefined) => (e ? { id: e.id, name: fullName(e), employeeCode: e.employeeCode } : null);

/** Today in the organization's time zone (YYYY-MM-DD). */
export async function organizationToday(organizationId: string): Promise<string> {
  const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
  return zonedParts(new Date(), org?.timezone ?? 'UTC').date;
}

/** Signed-in users of employees (active memberships only), for notifications. */
export async function userIdsOf(employeeIds: (string | null | undefined)[], transaction?: Transaction): Promise<Map<string, string>> {
  const ids = [...new Set(employeeIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const employees = await Employee.findAll({ where: { id: ids, membershipId: { [Op.ne]: null } }, attributes: ['id', 'membershipId'], transaction });
  const memberships = await OrganizationMembership.findAll({ where: { id: employees.map((e) => e.membershipId!), status: 'ACTIVE' }, attributes: ['id', 'userId'], transaction });
  const userBy = new Map(memberships.map((m) => [m.id, m.userId]));
  return new Map(employees.filter((e) => userBy.has(e.membershipId!)).map((e) => [e.id, userBy.get(e.membershipId!)!]));
}

/** Active members of the current organization whose roles grant the permission. */
export async function usersWithPermission(key: string, transaction?: Transaction): Promise<string[]> {
  const permission = await Permission.findOne({ where: { key }, attributes: ['id'], transaction });
  if (!permission) return [];
  const roleIds = (await RolePermission.findAll({ where: { permissionId: permission.id }, attributes: ['roleId'], transaction })).map((r) => r.roleId);
  if (!roleIds.length) return [];
  const membershipIds = (await MembershipRole.findAll({ where: { roleId: roleIds }, attributes: ['membershipId'], transaction })).map((m) => m.membershipId);
  if (!membershipIds.length) return [];
  const members = await OrganizationMembership.findAll({ where: { id: membershipIds, status: 'ACTIVE' }, attributes: ['userId'], transaction });
  return [...new Set(members.map((m) => m.userId))];
}
