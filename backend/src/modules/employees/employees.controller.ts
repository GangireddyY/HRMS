import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { CreateEmployeeDto, CreateFromMembersDto, EmployeeListQueryDto, LifecycleActionDto, SensitiveDetailsDto, UpdateEmployeeDto, UpdateMyEmployeeDto } from './dto/employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  // Static routes first so they are not captured by ":id".

  @Get('me')
  @RequireTenant()
  @ApiOperation({ summary: "The signed-in user's employee record (null when none is linked)" })
  me(@CurrentAuth() auth: AuthContext) {
    return this.employees.me(auth);
  }

  @Patch('me')
  @RequirePermissions('self.profile.update')
  @ApiOperation({ summary: 'Update own contact details and emergency contact' })
  updateMe(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateMyEmployeeDto) {
    return this.employees.updateMe(auth, dto);
  }

  @Get('export')
  @RequirePermissions('employee.view', 'employee.export')
  @ApiOperation({ summary: 'CSV export of employees within the caller’s scope' })
  async export(@CurrentAuth() auth: AuthContext, @Query() query: EmployeeListQueryDto) {
    const csv = await this.employees.exportCsv(auth, query);
    return new StreamableFile(Buffer.from(`\uFEFF${csv}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="employees.csv"' });
  }

  @Get('linkable-members')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Users without an employee record (to link on creation)' })
  linkableMembers() {
    return this.employees.linkableMembers();
  }

  @Post('from-members')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Create employee records for users who do not have one yet' })
  createFromMembers(@CurrentAuth() auth: AuthContext, @Body() dto: CreateFromMembersDto) {
    return this.employees.createFromMembers(auth, dto.membershipIds);
  }

  @Get()
  @RequirePermissions('employee.view')
  list(@CurrentAuth() auth: AuthContext, @Query() query: EmployeeListQueryDto) {
    return this.employees.list(auth, query);
  }

  @Post()
  @RequirePermissions('employee.create')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(auth, dto);
  }

  @Get(':id')
  @RequirePermissions('employee.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('employee.view', 'employee.update')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(auth, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employee.view', 'employee.delete')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.employees.remove(auth, id);
    return { deleted: true };
  }

  @Post(':id/lifecycle')
  @RequirePermissions('employee.view', 'employee.lifecycle.manage')
  @ApiOperation({ summary: 'Record a transfer, promotion, manager change, status change or confirmation' })
  lifecycle(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LifecycleActionDto) {
    return this.employees.applyLifecycle(auth, id, dto);
  }

  @Get(':id/history')
  @RequirePermissions('employee.view')
  history(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.history(auth, id);
  }

  @Get(':id/sensitive')
  @RequirePermissions('employee.view', 'employee.sensitive.view')
  @ApiOperation({ summary: 'Bank and statutory identifiers (decrypted; access is audited)' })
  sensitive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.getSensitive(auth, id);
  }

  @Put(':id/sensitive')
  @RequirePermissions('employee.view', 'employee.update', 'employee.sensitive.view')
  updateSensitive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SensitiveDetailsDto) {
    return this.employees.updateSensitive(auth, id, dto);
  }
}
