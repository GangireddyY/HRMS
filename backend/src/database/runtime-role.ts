import type { Sequelize } from 'sequelize-typescript';

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Gives the API's database role (DB_USER) row access only — no DDL, no TRUNCATE, no trigger changes, no access to the
 * migration ledger — after migrations ran as the schema owner. Creates the role when it doesn't exist yet (the owner
 * needs CREATEROLE for that; on managed databases create it once by hand instead). Safe to run after every migration.
 */
export async function grantRuntimeRole(sequelize: Sequelize, user: string, password: string): Promise<'created' | 'granted'> {
  const [rows] = await sequelize.query('SELECT 1 FROM pg_roles WHERE rolname = :user', { replacements: { user } });
  const role = ident(user);
  const created = rows.length === 0;
  if (created) {
    try {
      await sequelize.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${sequelize.escape(password)}`);
    } catch (e) {
      throw new Error(`Role "${user}" (DB_USER) doesn't exist and the migration user can't create it (${(e as Error).message}). Create it once as an administrator: CREATE ROLE ${role} LOGIN PASSWORD '…'; then run the migrations again.`);
    }
  }
  for (const sql of [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    `REVOKE ALL ON TABLE schema_migrations FROM ${role}`,
    `REVOKE UPDATE ON TABLE audit_logs FROM ${role}`,
  ]) {
    await sequelize.query(sql);
  }
  return created ? 'created' : 'granted';
}
