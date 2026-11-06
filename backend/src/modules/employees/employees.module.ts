import { Module } from '@nestjs/common';
import { EmployeeScopeService } from './employee-scope.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeScopeService],
  exports: [EmployeeScopeService],
})
export class EmployeesModule {}
