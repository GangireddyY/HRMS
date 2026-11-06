/**
 * Idempotent seed (`npm run db:seed`).
 *  - Reference data: permission/feature catalog (via app bootstrap) and subscription plans.
 *  - Platform bootstrap: the first Super Admin (SUPERADMIN_*).
 * Organizations are never seeded: owners create them through sign-up (POST /auth/register-organization)
 * and become their Organization Admin, or the Super Admin creates them from the platform console.
 * Production uses `node dist/cli/bootstrap.js` instead.
 */
import 'reflect-metadata';
import { loadEnvFile } from './env-file';
loadEnvFile();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PasswordHasher } from '../infrastructure/crypto/password-hasher.service';
import { ensureSuperAdmin, seedPlans } from '../infrastructure/seed/platform-bootstrap';

const logger = new Logger('Seed');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const hasher = app.get(PasswordHasher);
    for (const code of await seedPlans()) logger.log(`Plan created: ${code}`);
    if (await ensureSuperAdmin(hasher, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD)) {
      logger.log(`Super Admin created: ${process.env.SUPERADMIN_EMAIL}`);
    }
    logger.log('Seed complete');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
