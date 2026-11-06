import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@Controller({ version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'Permission catalog grouped by module, with entitlement flags' })
  catalog(@CurrentAuth() auth: AuthContext) {
    return this.roles.catalog(auth.features);
  }

  @Get('roles')
  @RequirePermissions('role.view')
  list() {
    return this.roles.list();
  }

  @Get('roles/:id')
  @RequirePermissions('role.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(auth, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(auth, id, dto);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Replace the permission set of a role' })
  setPermissions(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto) {
    return this.roles.setPermissions(auth, id, dto.permissions);
  }

  @Delete('roles/:id')
  @RequirePermissions('role.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.roles.remove(id);
    return { deleted: true };
  }
}
