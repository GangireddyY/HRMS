/**
 * Demo extras (`npm run db:seed:demo-extras [-- area …]`): scenario data on top of an existing Acme demo
 * organization, so screens show every state (payroll awaiting approval, overdue filings, resolved grievances…).
 * Safe to run again: each scenario skips itself when its data is already there. `npm run db:seed:demo` runs these
 * too, right after creating the demo organizations.
 */
import 'reflect-metadata';
import { loadEnvFile } from './env-file';
loadEnvFile();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { DatabaseService } from './database.service';
import { runDemoExtras } from './demo-extras/index';
import { createKit, demoOrganizationId } from './demo-extras/kit';
import { MailService } from '../infrastructure/mail/mail.service';

const logger = new Logger('DemoExtras');

async function main(): Promise<void> {
  ThrottlerGuard.prototype.canActivate = async () => true;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  app.get(MailService).send = async () => undefined;
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  try {
    const db = app.get(DatabaseService);
    const acmeId = await demoOrganizationId(db, 'admin@acme.test');
    if (!acmeId) throw new Error('The Acme Technologies demo organization does not exist yet. Run npm run db:seed:demo first.');
    const problems: string[] = [];
    const areas = process.argv.slice(2).filter((a) => !a.startsWith('-'));
    await runDemoExtras(createKit(base, db, acmeId, problems), areas.length ? areas : undefined);
    if (problems.length) {
      logger.warn(`${problems.length} scenario(s) could not be created:`);
      for (const p of problems) logger.warn(` - ${p}`);
      process.exitCode = 1;
    } else console.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
