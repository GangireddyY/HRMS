import { existsSync, readFileSync } from 'node:fs';
import type { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';

/** Applied migrations are tracked in `schema_migrations`. */
export function createMigrationStorage(sequelize: Sequelize): SequelizeStorage {
  return new SequelizeStorage({ sequelize, tableName: 'schema_migrations' });
}

/**
 * SQL migrations in `migrations/<timestamp>_<name>.up.sql` (+ optional `.down.sql`).
 * Each migration runs in its own transaction; applied migrations are tracked in `schema_migrations`.
 */
export function createMigrator(sequelize: Sequelize, logger: Pick<Console, 'info' | 'warn' | 'error'> | undefined = console) {
  return new Umzug({
    migrations: {
      glob: ['migrations/*.up.sql', { cwd: __dirname }],
      resolve: ({ name, path }) => {
        const file = path!;
        const downFile = file.replace(/\.up\.sql$/, '.down.sql');
        const run = (sqlFile: string) => sequelize.transaction((transaction) => sequelize.query(readFileSync(sqlFile, 'utf8'), { transaction }));
        return {
          name: name.replace(/\.up\.sql$/, ''),
          up: async () => {
            await run(file);
          },
          down: async () => {
            if (!existsSync(downFile)) throw new Error(`No down migration for ${name}`);
            await run(downFile);
          },
        };
      },
    },
    context: sequelize,
    storage: createMigrationStorage(sequelize),
    logger: logger ? { info: (m) => logger.info(m), warn: (m) => logger.warn(m), error: (m) => logger.error(m), debug: () => undefined } : undefined,
  });
}
