import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AssignEntityDto, ExchangeRateDto, LegalEntityDto } from './entities.dto';
import { EntitiesService } from './entities.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Legal entities & currencies')
@ApiBearerAuth()
@Controller({ version: '1' })
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get('legal-entities')
  @RequireTenant()
  @ApiOperation({ summary: 'The companies the organization employs people through' })
  list() {
    return this.entities.list();
  }

  @Post('legal-entities')
  @RequirePermissions('organization.update')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: LegalEntityDto) {
    return this.entities.create(auth, dto);
  }

  @Put('legal-entities/:id')
  @RequirePermissions('organization.update')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: LegalEntityDto) {
    return this.entities.update(auth, id, dto);
  }

  @Delete('legal-entities/:id')
  @RequirePermissions('organization.update')
  @HttpCode(204)
  async remove(@Param('id', UUID) id: string) {
    await this.entities.remove(id);
  }

  @Post('legal-entities/assign')
  @RequirePermissions('organization.update', 'employee.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move employees to an entity (null = the default entity)' })
  assign(@CurrentAuth() auth: AuthContext, @Body() dto: AssignEntityDto) {
    return this.entities.assign(auth, dto);
  }

  @Get('exchange-rates')
  @RequireTenant()
  @ApiOperation({ summary: 'Exchange rates into the base currency, newest first per currency' })
  rates(@CurrentAuth() auth: AuthContext) {
    return this.entities.rates(auth.organizationId!);
  }

  @Put('exchange-rates')
  @RequirePermissions('payroll.configure')
  @ApiOperation({ summary: 'Set the rate for a currency from a date (replaces the rate on that date)' })
  setRate(@CurrentAuth() auth: AuthContext, @Body() dto: ExchangeRateDto) {
    return this.entities.setRate(auth, dto);
  }

  @Delete('exchange-rates/:id')
  @RequirePermissions('payroll.configure')
  removeRate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.entities.removeRate(auth, id);
  }
}
