import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import {
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateLocationDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateLocationDto,
} from './dto/org-structure.dto';
import { OrgStructureService } from './org-structure.service';

const MANAGE = 'organization.structure.manage';

@ApiTags('Organization structure')
@ApiBearerAuth()
@Controller({ version: '1' })
export class OrgStructureController {
  constructor(private readonly structure: OrgStructureService) {}

  @Get('departments')
  @RequireTenant()
  @ApiOperation({ summary: 'Departments with active employee counts' })
  departments() {
    return this.structure.listDepartments();
  }

  @Post('departments')
  @RequirePermissions(MANAGE)
  createDepartment(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDepartmentDto) {
    return this.structure.createDepartment(auth, dto);
  }

  @Patch('departments/:id')
  @RequirePermissions(MANAGE)
  updateDepartment(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.structure.updateDepartment(auth, id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions(MANAGE)
  async deleteDepartment(@Param('id', ParseUUIDPipe) id: string) {
    await this.structure.remove('department', id);
    return { deleted: true };
  }

  @Get('designations')
  @RequireTenant()
  designations() {
    return this.structure.listDesignations();
  }

  @Post('designations')
  @RequirePermissions(MANAGE)
  createDesignation(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDesignationDto) {
    return this.structure.createDesignation(auth, dto);
  }

  @Patch('designations/:id')
  @RequirePermissions(MANAGE)
  updateDesignation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDesignationDto) {
    return this.structure.updateDesignation(auth, id, dto);
  }

  @Delete('designations/:id')
  @RequirePermissions(MANAGE)
  async deleteDesignation(@Param('id', ParseUUIDPipe) id: string) {
    await this.structure.remove('designation', id);
    return { deleted: true };
  }

  @Get('locations')
  @RequireTenant()
  locations() {
    return this.structure.listLocations();
  }

  @Post('locations')
  @RequirePermissions(MANAGE)
  createLocation(@CurrentAuth() auth: AuthContext, @Body() dto: CreateLocationDto) {
    return this.structure.createLocation(auth, dto);
  }

  @Patch('locations/:id')
  @RequirePermissions(MANAGE)
  updateLocation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.structure.updateLocation(auth, id, dto);
  }

  @Delete('locations/:id')
  @RequirePermissions(MANAGE)
  async deleteLocation(@Param('id', ParseUUIDPipe) id: string) {
    await this.structure.remove('location', id);
    return { deleted: true };
  }
}
