import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';
import { LeaveController } from './leave.controller';

@Module({
  imports: [EmployeesModule, AttendanceModule],
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveBalanceService, LeaveRequestsService],
  exports: [LeaveBalanceService],
})
export class LeaveModule {}
