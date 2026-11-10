import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequireTenant } from '../../common/auth/decorators';
import { CandidateQueryDto, CreateDelegationDto } from './delegations.dto';
import { DelegationsService } from './delegations.service';

@ApiTags('Approvals')
@ApiBearerAuth()
@RequireTenant()
@Controller({ path: 'approvals/delegations', version: '1' })
export class DelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  @Get()
  @ApiOperation({ summary: 'Delegations you gave and received (recent and upcoming), and what you can hand over' })
  overview(@CurrentAuth() auth: AuthContext) {
    return this.delegations.overview(auth);
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Colleagues who can sign in and could approve for you' })
  candidates(@CurrentAuth() auth: AuthContext, @Query() query: CandidateQueryDto) {
    return this.delegations.candidates(auth, query.search);
  }

  @Post()
  @ApiOperation({ summary: 'Hand your team approvals to a colleague for a period' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDelegationDto) {
    return this.delegations.create(auth, dto);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'End a delegation early (the delegator) or decline it (the delegate)' })
  revoke(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegations.revoke(auth, id);
  }
}
