import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { PayrollConfigService } from './payroll-config.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollController } from './payroll.controller';
import { ReimbursementsService } from './reimbursements.service';
import { SalariesService } from './salaries.service';

@Module({
  imports: [EmployeesModule, AttendanceModule],
  controllers: [PayrollController],
  providers: [PayrollConfigService, SalariesService, PayrollRunsService, ReimbursementsService],
})
export class PayrollModule {}
