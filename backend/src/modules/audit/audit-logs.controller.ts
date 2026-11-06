import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/decorators';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto, LoginEventQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get('audit-logs')
  @RequirePermissions('audit.view')
  list(@Query() query: AuditLogQueryDto) {
    return this.auditLogs.list(query);
  }

  @Get('login-events')
  @RequirePermissions('audit.login_history.view')
  loginEvents(@Query() query: LoginEventQueryDto) {
    return this.auditLogs.loginEvents(query);
  }
}
