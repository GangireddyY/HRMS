import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { LogArchivesController } from './log-archives.controller';
import { LogArchivesService } from './log-archives.service';

@Module({
  controllers: [AuditLogsController, LogArchivesController],
  providers: [AuditLogsService, LogArchivesService],
})
export class AuditLogsModule {}
