import { Module } from '@nestjs/common';
import { BankDetailsService } from './bank-details.service';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { EmployeeImportService } from './employee-import.service';
import { EmployeeProfileService } from './employee-profile.service';
import { EmployeeScopeService } from './employee-scope.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  controllers: [CustomFieldsController, EmployeesController],
  providers: [EmployeesService, EmployeeScopeService, EmployeeProfileService, EmployeeDocumentsService, EmployeeImportService, BankDetailsService, CustomFieldsService],
  exports: [EmployeeScopeService, EmployeeDocumentsService, EmployeesService, BankDetailsService, CustomFieldsService],
})
export class EmployeesModule {}
