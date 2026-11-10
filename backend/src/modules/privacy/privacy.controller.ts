import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireStepUp, RequireTenant } from '../../common/auth/decorators';
import { EraseEmployeeDto, PrivacySettingsDto } from './privacy.dto';
import { PrivacyService } from './privacy.service';

const json = (data: unknown, name: string) =>
  new StreamableFile(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), { type: 'application/json; charset=utf-8', disposition: `attachment; filename="${name}"` });
const stamp = () => new Date().toISOString().slice(0, 10);

@ApiTags('Privacy')
@ApiBearerAuth()
@Controller({ path: 'privacy', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('me/export')
  @RequireTenant()
  @RequireStepUp()
  @ApiOperation({ summary: 'Download the personal data this organization holds about you (JSON); needs a fresh step-up' })
  async exportMine(@CurrentAuth() auth: AuthContext) {
    return json(await this.privacy.exportMine(auth), `my-data-${stamp()}.json`);
  }

  @Get()
  @RequirePermissions('privacy.manage')
  @ApiOperation({ summary: 'Retention periods, former employees and candidates due for erasure' })
  overview(@CurrentAuth() auth: AuthContext) {
    return this.privacy.overview(auth);
  }

  @Put('settings')
  @RequirePermissions('privacy.manage')
  updateSettings(@CurrentAuth() auth: AuthContext, @Body() dto: PrivacySettingsDto) {
    return this.privacy.updateSettings(auth, dto);
  }

  @Get('employees/:id/export')
  @RequirePermissions('privacy.manage')
  @RequireStepUp()
  @ApiOperation({ summary: "An employee's personal data for a data request (JSON); audited, needs a fresh step-up" })
  async exportEmployee(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return json(await this.privacy.exportEmployee(auth, id), `personal-data-${id.slice(0, 8)}-${stamp()}.json`);
  }

  @Post('employees/:id/erase')
  @RequirePermissions('privacy.manage')
  @RequireStepUp()
  @ApiOperation({ summary: 'Erase a former employee’s personal data (statutory records kept until the retention period ends, then anonymized)' })
  erase(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EraseEmployeeDto) {
    return this.privacy.eraseEmployee(auth, id, dto.confirm);
  }

  @Post('candidates/purge')
  @RequirePermissions('privacy.manage')
  @ApiOperation({ summary: 'Anonymize candidates past the retention period now (also runs daily)' })
  purgeCandidates(@CurrentAuth() auth: AuthContext) {
    return this.privacy.purgeCandidates(auth.organizationId!, auth.userId);
  }
}
