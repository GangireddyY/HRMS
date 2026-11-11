import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldDefinitionDto, CustomFieldValuesDto, UpdateCustomFieldDefinitionDto } from './dto/custom-fields.dto';

const UUID = new ParseUUIDPipe();

@ApiTags('Employees')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get('custom-fields')
  @RequireTenant()
  @ApiOperation({ summary: 'Custom employee fields defined by the organization' })
  definitions(@CurrentAuth() auth: AuthContext, @Query('archived') archived?: string) {
    if (!auth.permissions.has('employee.view') && !auth.permissions.has('employee.fields.manage') && !auth.permissions.has('self.profile.update')) throw AppError.forbidden();
    return this.fields.definitions(archived === 'true' && auth.permissions.has('employee.fields.manage'));
  }

  @Post('custom-fields')
  @RequirePermissions('employee.fields.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CustomFieldDefinitionDto) {
    return this.fields.create(auth, dto);
  }

  @Patch('custom-fields/:id')
  @RequirePermissions('employee.fields.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateCustomFieldDefinitionDto) {
    return this.fields.update(auth, id, dto);
  }

  @Get('employees/me/custom-fields')
  @RequireTenant()
  mine(@CurrentAuth() auth: AuthContext) {
    return this.fields.values(auth, 'me');
  }

  @Put('employees/me/custom-fields')
  @RequirePermissions('self.profile.update')
  @ApiOperation({ summary: 'Fill in the custom fields you may edit' })
  setMine(@CurrentAuth() auth: AuthContext, @Body() dto: CustomFieldValuesDto) {
    return this.fields.setValues(auth, 'me', dto.values);
  }

  @Get('employees/:id/custom-fields')
  @RequirePermissions('employee.view')
  values(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.fields.values(auth, id);
  }

  @Put('employees/:id/custom-fields')
  @RequirePermissions('employee.view', 'employee.update')
  setValues(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CustomFieldValuesDto) {
    return this.fields.setValues(auth, id, dto.values);
  }
}
