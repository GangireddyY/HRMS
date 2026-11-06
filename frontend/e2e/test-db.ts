import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadApiTestEnv } from './env';

type PgClient = { connect(): Promise<void>; query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>; end(): Promise<void> };

/**
 * Direct access to the e2e test database, for steps that need a second person the browser tests cannot sign in as
 * (e.g. an approver other than the requester). Refuses to run against a database whose name lacks "test".
 */
export async function testDbQuery(sql: string, params: unknown[] = []): Promise<number> {
  const env = loadApiTestEnv();
  if (!/test/i.test(env.DB_NAME ?? '')) throw new Error(`Refusing to modify non-test database "${env.DB_NAME}"`);
  const require = createRequire(fileURLToPath(new URL('../../backend/package.json', import.meta.url)));
  const { Client } = require('pg') as { Client: new (config: object) => PgClient };
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    return (await client.query(sql, params)).rowCount ?? 0;
  } finally {
    await client.end();
  }
}
