import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePlatformPermissions } from '../../common/auth/decorators';
import {
  CreatePlanDto,
  CreatePlatformOrganizationDto,
  PlatformAuditQueryDto,
  PlatformOrganizationQueryDto,
  SetFeatureOverridesDto,
  SuspendOrganizationDto,
  UpdatePlanDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@ApiTags('Platform administration')
@ApiBearerAuth()
@Controller({ path: 'platform', version: '1' })
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('dashboard')
  @RequirePlatformPermissions('platform.organizations.view')
  dashboard() {
    return this.platform.dashboard();
  }

  @Get('organizations')
  @RequirePlatformPermissions('platform.organizations.view')
  listOrganizations(@Query() query: PlatformOrganizationQueryDto) {
    return this.platform.listOrganizations(query);
  }

  @Get('organizations/:id')
  @RequirePlatformPermissions('platform.organizations.view')
  getOrganization(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getOrganization(id);
  }

  @Post('organizations')
  @RequirePlatformPermissions('platform.organizations.manage')
  @ApiOperation({ summary: 'Create an organization and invite its first administrator' })
  createOrganization(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePlatformOrganizationDto) {
    return this.platform.createOrganization(auth, dto);
  }

  @Patch('organizations/:id')
  @RequirePlatformPermissions('platform.organizations.manage')
  updateOrganization(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlatformOrganizationDto) {
    return this.platform.updateOrganization(auth, id, dto);
  }

  @Post('organizations/:id/activate')
  @RequirePlatformPermissions('platform.organizations.manage')
  @HttpCode(200)
  activate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.changeStatus(auth, id, 'ACTIVE');
  }

  @Post('organizations/:id/suspend')
  @RequirePlatformPermissions('platform.organizations.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend an organization (all its sessions are revoked)' })
  suspend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendOrganizationDto) {
    return this.platform.changeStatus(auth, id, 'SUSPENDED', dto.reason);
  }

  @Post('organizations/:id/deactivate')
  @RequirePlatformPermissions('platform.organizations.manage')
  @HttpCode(200)
  deactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendOrganizationDto) {
    return this.platform.changeStatus(auth, id, 'DEACTIVATED', dto.reason);
  }

  @Put('organizations/:id/features')
  @RequirePlatformPermissions('platform.organizations.manage')
  @ApiOperation({ summary: 'Override module entitlements for one organization' })
  setFeatures(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeatureOverridesDto) {
    return this.platform.setFeatureOverrides(auth, id, dto);
  }

  @Post('organizations/:id/admins/:membershipId/resend-invitation')
  @RequirePlatformPermissions('platform.organizations.manage')
  @HttpCode(200)
  resendAdminInvitation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.platform.resendAdminInvitation(auth, id, membershipId);
  }

  @Get('plans')
  @RequirePlatformPermissions('platform.organizations.view')
  listPlans() {
    return this.platform.listPlans();
  }

  @Get('plans/:id')
  @RequirePlatformPermissions('platform.organizations.view')
  getPlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getPlan(id);
  }

  @Post('plans')
  @RequirePlatformPermissions('platform.plans.manage')
  createPlan(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePlanDto) {
    return this.platform.createPlan(auth, dto);
  }

  @Patch('plans/:id')
  @RequirePlatformPermissions('platform.plans.manage')
  updatePlan(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.platform.updatePlan(auth, id, dto);
  }

  @Get('features')
  @RequirePlatformPermissions('platform.organizations.view')
  features() {
    return this.platform.listFeatures();
  }

  @Get('audit-logs')
  @RequirePlatformPermissions('platform.audit.view')
  auditLogs(@Query() query: PlatformAuditQueryDto) {
    return this.platform.auditLogs(query);
  }
}
