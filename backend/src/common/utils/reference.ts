import type { Sequelize, Transaction } from 'sequelize';

/** The next sequential reference after the existing ones with the prefix, e.g. HD-0042 → HD-0043. */
export function nextReference(existing: string[], prefix: string, width = 4): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = existing.reduce((m, r) => Math.max(m, Number(pattern.exec(r)?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

/**
 * Allocates the next reference for the organization inside the transaction. A transaction-scoped advisory lock
 * serializes concurrent allocations (including the very first one, when there are no rows to lock).
 */
export async function allocateReference(sequelize: Sequelize, transaction: Transaction, organizationId: string, prefix: string, existing: () => Promise<string[]>): Promise<string> {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: `reference:${organizationId}:${prefix}` }, transaction });
  return nextReference(await existing(), prefix);
}
