import { Op,type Transaction } from 'sequelize';
import { Employee,MembershipRole,OrganizationMembership,Permission,RolePermission } from '../../database/models';

/** Users of the employees who have an active membership. */
export async function userIdsOfEmployees(employeeIds: string[], transaction?: Transaction): Promise<Map<string, string>> {
  if (!employeeIds.length) return new Map();
  const employees = await Employee.findAll({ where: { id: employeeIds, membershipId: { [Op.ne]: null } }, attributes: ['id', 'membershipId'], transaction });
  const memberships = await OrganizationMembership.findAll({ where: { id: employees.map((e) => e.membershipId!), status: 'ACTIVE' }, attributes: ['id', 'userId'], transaction });
  const userBy = new Map(memberships.map((m) => [m.id, m.userId]));
  return new Map(employees.filter((e) => userBy.has(e.membershipId!)).map((e) => [e.id, userBy.get(e.membershipId!)!]));
}

/** Active members whose roles grant the permission. */
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
