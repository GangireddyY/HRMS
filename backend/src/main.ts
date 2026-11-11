// Must stay first: tracing patches modules as they are loaded.
import { tracingEnabled } from './tracing';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { AppConfig } from './config/app-config.service';
import { JobQueueService } from './infrastructure/jobs/job-queue.service';
import { ErrorReporter } from './infrastructure/observability/error-reporter';
import { JsonLogger } from './infrastructure/observability/json-logger';
import { ApprovalSlaJob } from './modules/approvals/approval-sla.job';
import { TimesheetReminderJob } from './modules/attendance/timesheet-reminder.job';
import { LeaveAccrualJob } from './modules/leave/leave-accrual.job';
import { NotificationDigestService } from './modules/notifications/digest.service';
import { PrivacyRetentionJob } from './modules/privacy/privacy-retention.job';
import { ReportSchedulesService } from './modules/reports/schedules/report-schedules.service';

async function bootstrap(): Promise<void> {
  // Read before the config module loads: the logger is needed while the app is being built.
  const json = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, ...(json ? { logger: new JsonLogger() } : {}) });
  configureApp(app);
  const config = app.get(AppConfig);
  if (!config.isProduction) setupSwagger(app);
  const errors = app.get(ErrorReporter);
  process.on('unhandledRejection', (reason) => {
    Logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined, 'Process');
    errors.capture(reason, { tags: { source: 'unhandledRejection' } });
  });
  const port = config.get('PORT');
  await app.listen(port);
  app.get(JobQueueService).start();
  app.get(TimesheetReminderJob).start();
  app.get(PrivacyRetentionJob).start();
  app.get(LeaveAccrualJob).start();
  app.get(ApprovalSlaJob).start();
  app.get(NotificationDigestService).start();
  app.get(ReportSchedulesService).start();
  Logger.log(`HRMS API listening on http://localhost:${port}/api/v1 (docs: /api/docs)${errors.enabled ? '; error reporting on' : ''}${tracingEnabled ? '; tracing on' : ''}`, 'Bootstrap');
}

void bootstrap();
