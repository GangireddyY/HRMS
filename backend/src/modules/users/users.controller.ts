import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { InviteUserDto, SetUserRolesDto, UserListQueryDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'List organization users (paginated, searchable, sortable)' })
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions('user.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post('invitations')
  @RequirePermissions('user.invite')
  @ApiOperation({ summary: 'Invite a user and assign roles' })
  invite(@CurrentAuth() auth: AuthContext, @Body() dto: InviteUserDto) {
    return this.users.invite(auth, dto);
  }

  @Post(':id/invitation/resend')
  @RequirePermissions('user.invite')
  @HttpCode(200)
  resend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.resendInvitation(auth, id);
  }

  @Delete(':id/invitation')
  @RequirePermissions('user.invite')
  async cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.cancelInvitation(auth, id);
    return { cancelled: true };
  }

  @Put(':id/roles')
  @RequirePermissions('user.update')
  setRoles(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserRolesDto) {
    return this.users.setRoles(auth, id, dto.roleIds);
  }

  @Post(':id/suspend')
  @RequirePermissions('user.update')
  @HttpCode(200)
  suspend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.suspend(auth, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('user.update')
  @HttpCode(200)
  reactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.reactivate(auth, id);
  }

  @Post(':id/sessions/revoke')
  @RequirePermissions('user.sessions.revoke')
  @HttpCode(200)
  revokeSessions(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revokeSessions(auth, id);
  }

  @Get(':id/login-history')
  @RequirePermissions('audit.login_history.view')
  loginHistory(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.users.loginHistory(id, query);
  }
}
