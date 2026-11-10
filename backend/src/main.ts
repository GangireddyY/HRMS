import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { AppConfig } from './config/app-config.service';
import { TimesheetReminderJob } from './modules/attendance/timesheet-reminder.job';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  configureApp(app);
  const config = app.get(AppConfig);
  if (!config.isProduction) setupSwagger(app);
  const port = config.get('PORT');
  await app.listen(port);
  app.get(TimesheetReminderJob).start();
  Logger.log(`HRMS API listening on http://localhost:${port}/api/v1 (docs: /api/docs)`, 'Bootstrap');
}

void bootstrap();
