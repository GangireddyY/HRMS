import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
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
import { StatutoryRatesController, StatutoryRatesInForceController } from './statutory-rates.controller';
import { StatutoryRatesService } from './statutory-rates.service';
import { StatutoryController } from './statutory.controller';
import { StatutoryService } from './statutory.service';
import { TaxProofsService } from './tax-proofs.service';

@Module({
  imports: [EmployeesModule, AttendanceModule],
  controllers: [PayrollController, StatutoryController, AccountingController, StatutoryRatesController, StatutoryRatesInForceController],
  providers: [StatutoryRatesService, AccountingService, PayrollConfigService, SalariesService, PayrollCalculationService, PayslipsService, PayrollExportsService, PayrollRunsService, ReimbursementsService, ExpensePolicyService, LoansService, TaxProofsService, StatutoryService, PayGroupsService],
  exports: [SalariesService, ReimbursementsService, LoansService, PayrollRunsService],
})
export class PayrollModule {}
