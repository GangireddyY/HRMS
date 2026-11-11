import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequireTenant } from '../../common/auth/decorators';
import { ApprovalInboxService } from './approval-inbox.service';

@ApiTags('Approval chains')
@ApiBearerAuth()
@Controller({ path: 'approvals/waiting', version: '1' })
export class ApprovalInboxController {
  constructor(private readonly inbox: ApprovalInboxService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Requests waiting at an approval-chain step you decide (yourself or covering someone), across kinds' })
  waiting(@CurrentAuth() auth: AuthContext) {
    return this.inbox.waiting(auth);
  }
}
