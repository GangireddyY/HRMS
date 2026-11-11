import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { AppConfig } from './config/app-config.service';
import { validateEnv } from './config/env';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AuditModule } from './infrastructure/audit/audit.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { JobsModule } from './infrastructure/jobs/jobs.module';
import { REDIS, RedisModule } from './infrastructure/redis/redis.module';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage';
import type Redis from 'ioredis';
import { DatabaseModule } from './database/database.module';
import { AuditLogsModule } from './modules/audit/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { HealthController } from './modules/health/health.controller';
import { MetricsController } from './modules/health/metrics.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UsersModule } from './modules/users/users.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { LeaveModule } from './modules/leave/leave.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { TrainingModule } from './modules/training/training.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { GrievanceModule } from './modules/grievance/grievance.module';
import { BenefitsModule } from './modules/benefits/benefits.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { ExitModule } from './modules/exit/exit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ImportsModule } from './modules/imports/imports.module';
import { BillingModule } from './modules/billing/billing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { OrgStructureModule } from './modules/org-structure/org-structure.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ServicesModule } from './modules/services/services.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
      validate: validateEnv,
    }),
    AppConfigModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [AppConfig, REDIS],
      useFactory: (config: AppConfig, redis: Redis | null) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => config.isTest && process.env.TEST_ENABLE_THROTTLE !== '1',
        // Shared counters across instances when Redis is configured; in memory otherwise.
        ...(redis ? { storage: new RedisThrottlerStorage(redis) } : {}),
      }),
    }),
    JobsModule,
    DatabaseModule,
    CryptoModule,
    MailModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    RbacModule,
    OrganizationsModule,
    AuthModule,
    UsersModule,
    AuditLogsModule,
    PlatformModule,
    OrgStructureModule,
    EmployeesModule,
    AttendanceModule,
    LeaveModule,
    OnboardingModule,
    RecruitmentModule,
    PayrollModule,
    PerformanceModule,
    TrainingModule,
    EngagementModule,
    GrievanceModule,
    BenefitsModule,
    ComplianceModule,
    ExitModule,
    ReportsModule,
    ImportsModule,
    BillingModule,
    DashboardModule,
    PrivacyModule,
    ApprovalsModule,
    ServicesModule,
    IntegrationsModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Outermost first: idempotency replays the enveloped response.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Order matters: rate limit → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
