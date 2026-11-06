/**
 * Migration CLI.
 *   npm run db:migrate            (dev, ts-node)     |  node dist/database/migrate.js up   (production)
 *   npm run db:migrate:down       revert the last migration
 *   npm run db:migrate:status     list executed / pending migrations
 *   npm run db:migrate:baseline   mark pending migrations as applied on a database whose schema already
 *                                 exists (e.g. created by the previous Prisma migrations); never runs SQL
 */
import { loadEnvFile } from './env-file';
import { createMigrationStorage, createMigrator } from './migrator';
import { createSequelize, databaseConnectionFromEnv } from './sequelize';

async function main(): Promise<void> {
  loadEnvFile();
  const command = process.argv[2] ?? 'up';
  const sequelize = createSequelize(databaseConnectionFromEnv(), { withModels: false });
  const migrator = createMigrator(sequelize, { info: () => undefined, warn: console.warn, error: console.error });
  try {
    if (command === 'up') {
      const applied = await migrator.up();
      console.log(applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'No pending migrations');
    } else if (command === 'down') {
      const reverted = await migrator.down();
      console.log(reverted.length ? `Reverted: ${reverted.map((m) => m.name).join(', ')}` : 'Nothing to revert');
    } else if (command === 'baseline') {
      const [{ exists }] = (await sequelize.query(`SELECT to_regclass('public.users') IS NOT NULL AS exists`, { plain: false, raw: true }))[0] as { exists: boolean }[];
      if (!exists) throw new Error('No existing schema found; run "up" instead of "baseline"');
      const pending = await migrator.pending();
      const storage = createMigrationStorage(sequelize);
      for (const m of pending) await storage.logMigration({ name: m.name });
      console.log(pending.length ? `Baselined: ${pending.map((m) => m.name).join(', ')}` : 'Nothing to baseline');
    } else if (command === 'status') {
      const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
      console.log(`Executed (${executed.length}):\n  ${executed.map((m) => m.name).join('\n  ') || '-'}`);
      console.log(`Pending (${pending.length}):\n  ${pending.map((m) => m.name).join('\n  ') || '-'}`);
    } else {
      throw new Error(`Unknown command "${command}" (use up | down | status | baseline)`);
    }
  } finally {
    await sequelize.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
