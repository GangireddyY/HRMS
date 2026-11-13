import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { AccountingService } from './accounting.service';
import { AccountingSettingsDto, TallyExportQueryDto } from './dto/accounting.dto';

const UUID = new ParseUUIDPipe();
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Payroll – accounting')
@ApiBearerAuth()
@Controller({ path: 'payroll', version: '1' })
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounting')
  @RequireTenant()
  @ApiOperation({ summary: 'Ledger names payroll posts to, and the Tally company and voucher type' })
  settings(@CurrentAuth() auth: AuthContext) {
    if (!auth.features.has('payroll')) throw AppError.forbidden('Payroll is not enabled for your organization');
    if (!auth.permissions.has('payroll.view') && !auth.permissions.has('payroll.configure')) throw AppError.forbidden();
    return this.accounting.settings(auth.organizationId!);
  }

  @Put('accounting')
  @RequirePermissions('payroll.configure')
  @ApiOperation({ summary: 'Rename ledgers, map earning components to their own ledgers, switch department cost centres' })
  update(@CurrentAuth() auth: AuthContext, @Body() dto: AccountingSettingsDto) {
    return this.accounting.update(auth, dto);
  }

  @Get('runs/:id/journal')
  @RequirePermissions('payroll.view')
  @ApiOperation({ summary: 'Balanced accounting journal of an approved run' })
  journal(@Param('id', UUID) id: string) {
    return this.accounting.preview(id);
  }

  @Get('runs/:id/tally')
  @RequirePermissions('payroll.view')
  @ApiOperation({ summary: 'Tally import XML: the journal voucher, or the ledger and cost-centre masters it uses (part=masters)' })
  async tally(@Param('id', UUID) id: string, @Query() query: TallyExportQueryDto) {
    const f = await this.accounting.tally(id, query.part);
    return new StreamableFile(Buffer.from(f.content, 'utf8'), { type: 'application/xml; charset=utf-8', disposition: attachment(f.fileName) });
  }
}
