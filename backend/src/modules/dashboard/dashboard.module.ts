import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { ExitModule } from '../exit/exit.module';
import { LeaveModule } from '../leave/leave.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { ServicesModule } from '../services/services.module';
import { ApprovalsSummaryService } from './approvals-summary.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [EmployeesModule, LeaveModule, AttendanceModule, PayrollModule, RecruitmentModule, ExitModule, ServicesModule, OnboardingModule],
  controllers: [DashboardController],
  providers: [ApprovalsSummaryService],
})
export class DashboardModule {}
