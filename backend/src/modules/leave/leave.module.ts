import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesModule } from '../employees/employees.module';
import { RbacModule } from '../rbac/rbac.module';
import { CompOffService } from './comp-off.service';
import { EncashmentsService } from './encashments.service';
import { LeaveAccrualJob } from './leave-accrual.job';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';
import { LeaveController } from './leave.controller';

@Module({
  imports: [EmployeesModule, AttendanceModule, RbacModule],
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveBalanceService, LeaveRequestsService, CompOffService, EncashmentsService, LeaveAccrualJob],
  exports: [LeaveBalanceService],
})
export class LeaveModule {}
