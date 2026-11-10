import { Op, type Transaction } from 'sequelize';
import { zonedParts } from '../../common/utils/zoned-time';
import { ApprovalDelegation, Employee, MembershipRole, Organization, OrganizationMembership, Permission, RolePermission } from '../../database/models';

import { fullName } from '../../common/utils/names';

export { fullName };
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

/** The manager's user and whoever is approving on the manager's behalf today (approval delegation). */
export async function managerAndCover(managerEmployeeId: string | null | undefined, transaction?: Transaction): Promise<string[]> {
  if (!managerEmployeeId) return [];
  const manager = await Employee.findByPk(managerEmployeeId, { attributes: ['id', 'organizationId', 'membershipId'], transaction });
  if (!manager?.membershipId) return [];
  const today = await organizationToday(manager.organizationId);
  const delegations = await ApprovalDelegation.findAll({
    where: { delegatorMembershipId: manager.membershipId, revokedAt: null, startsOn: { [Op.lte]: today }, endsOn: { [Op.gte]: today } },
    attributes: ['delegateMembershipId'],
    transaction,
  });
  const memberships = await OrganizationMembership.findAll({
    where: { id: [manager.membershipId, ...delegations.map((d) => d.delegateMembershipId)], status: 'ACTIVE' },
    attributes: ['id', 'userId'],
    transaction,
  });
  const order = (id: string) => (id === manager.membershipId ? 0 : 1);
  return [...new Set(memberships.sort((a, b) => order(a.id) - order(b.id)).map((m) => m.userId))];
}

/** Active members of the current organization whose roles grant the permission. */
export async function usersWithPermission(key: string, transaction?: Transaction, scopes?: string[]): Promise<string[]> {
  const permission = await Permission.findOne({ where: { key }, attributes: ['id'], transaction });
  if (!permission) return [];
  const roleIds = (await RolePermission.findAll({ where: { permissionId: permission.id, ...(scopes ? { scope: scopes } : {}) }, attributes: ['roleId'], transaction })).map((r) => r.roleId);
  if (!roleIds.length) return [];
  const membershipIds = (await MembershipRole.findAll({ where: { roleId: roleIds }, attributes: ['membershipId'], transaction })).map((m) => m.membershipId);
  if (!membershipIds.length) return [];
  const members = await OrganizationMembership.findAll({ where: { id: membershipIds, status: 'ACTIVE' }, attributes: ['userId'], transaction });
  return [...new Set(members.map((m) => m.userId))];
}
