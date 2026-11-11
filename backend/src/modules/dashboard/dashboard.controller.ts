import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequireTenant } from '../../common/auth/decorators';
import { ApprovalsSummaryService } from './approvals-summary.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly approvals: ApprovalsSummaryService) {}

  @Get('approvals')
  @RequireTenant()
  @ApiOperation({ summary: 'How many requests wait for your decision, per kind you may decide (one request for the dashboard)' })
  approvalsSummary(@CurrentAuth() auth: AuthContext) {
    return this.approvals.summary(auth);
  }
}
