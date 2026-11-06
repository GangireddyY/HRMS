/**
 * Production-safe platform bootstrap (idempotent). Run after migrations:
 *   node dist/database/migrate.js up && node dist/cli/bootstrap.js
 * - Synchronises the permission/feature catalog (on application bootstrap).
 * - Creates default subscription plans if missing.
 * - Creates the first Super Admin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD if missing.
 * Never creates demo data.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PasswordHasher } from '../infrastructure/crypto/password-hasher.service';
import { ensureSuperAdmin, seedPlans } from '../infrastructure/seed/platform-bootstrap';

async function main(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    for (const code of await seedPlans()) logger.log(`Plan created: ${code}`);
    const created = await ensureSuperAdmin(app.get(PasswordHasher), process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
    if (created) logger.log(`Super Admin created: ${process.env.SUPERADMIN_EMAIL}`);
    logger.log('Platform bootstrap complete');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  new Logger('Bootstrap').error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
