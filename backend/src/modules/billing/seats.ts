import type { Transaction } from 'sequelize';
import { Organization, OrganizationSubscription, Plan } from '../../database/models';

/** The seats an organization may use: the subscription's limit, else the plan's (null = unlimited). */
export async function seatLimit(organizationId: string, transaction?: Transaction): Promise<number | null> {
  const [sub, org] = await Promise.all([
    OrganizationSubscription.findOne({ where: { organizationId }, attributes: ['seats'], transaction, skipTenantScope: true }),
    Organization.findByPk(organizationId, { attributes: ['id'], include: [{ model: Plan, attributes: ['maxUsers'] }], transaction }),
  ]);
  return sub?.seats ?? org?.plan?.maxUsers ?? null;
}
