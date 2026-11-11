import { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { RequestContext } from '../common/context/request-context';

/** PostgreSQL setting the row-level security policies read (see the row_level_security migration). */
export const TENANT_SETTING = 'app.organization_id';

interface PgConnection {
  query(text: string, values?: unknown[]): Promise<unknown>;
  /** Session-level value last set on this connection. */
  hrmsTenant?: string;
  /** Transaction-local value, for the root transaction it was set in. */
  hrmsLocal?: { tx: string; value: string };
}
interface Tx {
  id: string;
  parent?: Tx | null;
  connection?: PgConnection;
  hrmsReady?: boolean;
}
interface QueryOptions {
  skipTenantScope?: boolean;
  transaction?: Tx | null;
}

/** The organization a statement is confined to; '' lets it see every organization (opted out, or no tenant context). */
export function tenantFor(options: { skipTenantScope?: boolean } | undefined): string {
  if (options?.skipTenantScope) return '';
  return RequestContext.organizationId() ?? '';
}

const rootOf = (tx: Tx): Tx => (tx.parent ? rootOf(tx.parent) : tx);
const SET = `SELECT set_config('${TENANT_SETTING}', $1, $2)`;

let patched = false;
/** Transactions get their tenant only once BEGIN and the isolation level have run; a rolled-back savepoint drops it. */
function patchTransactions(): void {
  if (patched) return;
  patched = true;
  const proto = Transaction.prototype as unknown as { prepareEnvironment(this: Tx, ...a: unknown[]): Promise<unknown>; rollback(this: Tx): Promise<void> };
  const prepare = proto.prepareEnvironment;
  proto.prepareEnvironment = async function (this: Tx, ...args: unknown[]) {
    const result = await prepare.apply(this, args);
    this.hrmsReady = true;
    return result;
  };
  const rollback = proto.rollback;
  proto.rollback = async function (this: Tx) {
    await rollback.apply(this);
    if (this.parent && this.connection) this.connection.hrmsLocal = undefined;
  };
}

/**
 * Database-level tenant isolation behind the ORM's tenant hooks: before every statement the connection's
 * `app.organization_id` is set to the request's organization (or '' for statements that opted out with
 * `skipTenantScope`, and outside any tenant context), and PostgreSQL row-level security hides and refuses rows of
 * other organizations — covering raw SQL and nested includes, which the hooks don't see. The value is sent only when it
 * changes for that connection (or transaction).
 */
export function installRowLevelSecurity(sequelize: Sequelize): void {
  patchTransactions();
  sequelize.addHook('beforeQuery', async (queryOptions, query) => {
    const options = queryOptions as QueryOptions;
    const want = tenantFor(options);
    const conn = (query as unknown as { connection: PgConnection }).connection;
    const tx = options.transaction;
    if (tx) {
      const root = rootOf(tx);
      if (!root.hrmsReady || !tx.hrmsReady) return;
      const local = conn.hrmsLocal;
      const current = local && local.tx === root.id ? local.value : (conn.hrmsTenant ?? '');
      if (current === want) return;
      await conn.query(SET, [want, true]);
      conn.hrmsLocal = { tx: root.id, value: want };
      return;
    }
    if ((conn.hrmsTenant ?? '') === want) return;
    await conn.query(SET, [want, false]);
    conn.hrmsTenant = want;
  });
}
