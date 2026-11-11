import { Sequelize } from 'sequelize-typescript';
import { ALL_MODELS, TENANT_MODELS } from './models';
import { installRowLevelSecurity } from './row-level-security';
import { installTenantHooks } from './tenant-scope';

export interface DatabaseConnection {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  /** Require TLS with certificate verification (managed databases). */
  ssl: boolean;
}

/**
 * Reads DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD and DB_SSL from the environment.
 * Used by CLIs (migrations) that run without the Nest config module; the API validates the same keys in config/env.ts.
 * With `{ migration: true }`, DB_MIGRATION_USER / DB_MIGRATION_PASSWORD (the schema owner) are used when set, so the
 * API itself can run as a least-privilege role that can't alter tables or disable the audit trail's triggers.
 */
export function databaseConnectionFromEnv(env: NodeJS.ProcessEnv = process.env, opts: { migration?: boolean } = {}): DatabaseConnection {
  const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing database configuration: ${missing.join(', ')}`);
  const port = Number(env.DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid DB_PORT "${env.DB_PORT}"`);
  const owner = opts.migration && env.DB_MIGRATION_USER;
  return {
    host: env.DB_HOST || 'localhost',
    port,
    name: env.DB_NAME!,
    user: owner ? env.DB_MIGRATION_USER! : env.DB_USER!,
    password: owner ? (env.DB_MIGRATION_PASSWORD ?? '') : env.DB_PASSWORD!,
    ssl: env.DB_SSL === 'true' || env.DB_SSL === '1',
  };
}

export function createSequelize(
  db: DatabaseConnection,
  opts: { withModels: boolean; logging?: boolean } = { withModels: true },
): Sequelize {
  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: db.host,
    port: db.port,
    database: db.name,
    username: db.user,
    password: db.password,
    dialectOptions: db.ssl ? { ssl: { require: true, rejectUnauthorized: true } } : undefined,
    logging: opts.logging ? (sql: string) => console.debug(sql) : false,
    pool: { max: 10, min: 0, idle: 10_000, acquire: 30_000 },
    define: { underscored: true },
    models: opts.withModels ? ALL_MODELS : [],
  });
  if (opts.withModels) {
    installTenantHooks(TENANT_MODELS);
    installRowLevelSecurity(sequelize);
  }
  return sequelize;
}
