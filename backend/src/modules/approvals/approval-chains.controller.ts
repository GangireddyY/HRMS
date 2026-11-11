import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { ApprovalChainConfigService } from './approval-chain-config.service';
import { ApprovalChainDto, ApprovalChainQueryDto } from './approval-chains.dto';

@ApiTags('Approval chains')
@ApiBearerAuth()
@Controller({ path: 'approvals/chains', version: '1' })
export class ApprovalChainsController {
  constructor(private readonly config: ApprovalChainConfigService) {}

  @Get()
  @RequirePermissions('approvals.configure')
  @ApiOperation({ summary: 'Approval chains per kind of request, in the order they are tried' })
  list(@Query() query: ApprovalChainQueryDto) {
    return this.config.list(query);
  }

  @Post()
  @RequirePermissions('approvals.configure')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: ApprovalChainDto) {
    return this.config.create(auth, dto);
  }

  @Put(':id')
  @RequirePermissions('approvals.configure')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalChainDto) {
    return this.config.update(auth, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('approvals.configure')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.config.remove(auth, id);
  }
}
