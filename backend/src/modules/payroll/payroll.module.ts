import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { LoansService } from './loans.service';
import { PayGroupsService } from './pay-groups.service';
import { PayrollConfigService } from './payroll-config.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollExportsService } from './payroll-exports.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipsService } from './payslips.service';
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
  providers: [PayrollConfigService, SalariesService, PayrollCalculationService, PayslipsService, PayrollExportsService, PayrollRunsService, ReimbursementsService, ExpensePolicyService, LoansService, TaxProofsService, StatutoryService, PayGroupsService],
  exports: [SalariesService, ReimbursementsService, LoansService, PayrollRunsService],
})
export class PayrollModule {}
