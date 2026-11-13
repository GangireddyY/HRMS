import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePlatformPermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ContributionRatesDto, TaxRulesDto } from './dto/statutory-rates.dto';
import { StatutoryRatesService } from './statutory-rates.service';

function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('payroll')) throw AppError.forbidden('Payroll is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

/** Statutory rates every organization's payroll uses (platform administrators keep them current each year). */
@ApiTags('Platform')
@Controller({ path: 'platform/statutory-rates', version: '1' })
export class StatutoryRatesController {
  constructor(private readonly rates: StatutoryRatesService) {}

  @Get()
  @RequirePlatformPermissions('platform.statutory.manage')
  @ApiOperation({ summary: 'PF / ESI rates by effective date and income-tax rules by financial year (entered or built in)' })
  overview() {
    return this.rates.overview();
  }

  @Put('contribution')
  @RequirePlatformPermissions('platform.statutory.manage')
  @ApiOperation({ summary: 'Add or change the PF / EPS / ESI rates in force from a date' })
  saveContribution(@CurrentAuth() auth: AuthContext, @Body() dto: ContributionRatesDto) {
    return this.rates.saveContribution(auth, dto);
  }

  @Delete('contribution/:id')
  @RequirePlatformPermissions('platform.statutory.manage')
  removeContribution(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rates.removeContribution(auth, id);
  }

  @Put('tax/:fy')
  @RequirePlatformPermissions('platform.statutory.manage')
  @ApiOperation({ summary: "Enter a financial year's income-tax rules (2027 = FY 2027-28)" })
  saveTaxRules(@CurrentAuth() auth: AuthContext, @Param('fy', ParseIntPipe) fy: number, @Body() dto: TaxRulesDto) {
    return this.rates.saveTaxRules(auth, fy, dto);
  }

  @Delete('tax/:fy')
  @RequirePlatformPermissions('platform.statutory.manage')
  removeTaxRules(@CurrentAuth() auth: AuthContext, @Param('fy', ParseIntPipe) fy: number) {
    return this.rates.removeTaxRules(auth, fy);
  }
}

/** What payroll uses for a month, for the organization's payroll team. */
@ApiTags('Payroll')
@Controller({ path: 'payroll/statutory-rates', version: '1' })
export class StatutoryRatesInForceController {
  constructor(private readonly rates: StatutoryRatesService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'PF / ESI rates and income-tax rules in force for a month' })
  async inForce(@CurrentAuth() auth: AuthContext, @Query('year', ParseIntPipe) year: number, @Query('month', ParseIntPipe) month: number) {
    requireAny(auth, 'payroll.configure', 'payroll.view');
    const fy = month >= 4 ? year : year - 1;
    const [contribution, tax] = await Promise.all([this.rates.contributionRates(year, month), this.rates.taxRules(fy)]);
    return { contribution, tax: { financialYear: fy, rulesYear: tax.year, source: tax.source, confirmed: tax.confirmed, rules: tax.set } };
  }
}
