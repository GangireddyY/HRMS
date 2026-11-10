import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { LoansService } from './loans.service';
import { PayGroupsService } from './pay-groups.service';
import { PayrollConfigService } from './payroll-config.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollController } from './payroll.controller';
import { ExpensePolicyService } from './expense-policy.service';
import { ReimbursementsService } from './reimbursements.service';
import { SalariesService } from './salaries.service';
import { StatutoryController } from './statutory.controller';
import { StatutoryService } from './statutory.service';
import { TaxProofsService } from './tax-proofs.service';

@Module({
  imports: [EmployeesModule, AttendanceModule],
  controllers: [PayrollController, StatutoryController],
  providers: [PayrollConfigService, SalariesService, PayrollRunsService, ReimbursementsService, ExpensePolicyService, LoansService, TaxProofsService, StatutoryService, PayGroupsService],
  exports: [SalariesService],
})
export class PayrollModule {}
