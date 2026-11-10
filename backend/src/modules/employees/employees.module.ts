import { Module } from '@nestjs/common';
import { BankDetailsService } from './bank-details.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { EmployeeImportService } from './employee-import.service';
import { EmployeeProfileService } from './employee-profile.service';
import { EmployeeScopeService } from './employee-scope.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeScopeService, EmployeeProfileService, EmployeeDocumentsService, EmployeeImportService, BankDetailsService],
  exports: [EmployeeScopeService, EmployeeDocumentsService, EmployeesService, BankDetailsService],
})
export class EmployeesModule {}
