import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AttendanceConfigService } from './attendance-config.service';
import { AttendancePeriodsService } from './attendance-periods.service';
import { AttendanceRulesService } from './attendance-rules.service';
import { AttendanceController, HolidaysController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { RegularizationService } from './regularization.service';

@Module({
  imports: [EmployeesModule],
  controllers: [AttendanceController, HolidaysController],
  providers: [AttendanceService, AttendanceRulesService, AttendanceConfigService, RegularizationService, AttendancePeriodsService],
  exports: [AttendanceRulesService],
})
export class AttendanceModule {}
