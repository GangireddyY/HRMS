import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { RbacModule } from '../rbac/rbac.module';
import { AttendanceConfigService } from './attendance-config.service';
import { AttendancePeriodsService } from './attendance-periods.service';
import { AttendanceRulesService } from './attendance-rules.service';
import { AttendanceController, DevicePunchesController, HolidaysController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { DevicesService } from './devices.service';
import { OfficialHolidaysService } from './official-holidays.service';
import { OvertimeService } from './overtime.service';
import { RegularizationService } from './regularization.service';
import { RosterService } from './roster.service';
import { TimesheetReminderJob } from './timesheet-reminder.job';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';
import { WorkFromHomeService } from './work-from-home.service';

@Module({
  imports: [EmployeesModule, RbacModule],
  controllers: [TimesheetsController, AttendanceController, HolidaysController, DevicePunchesController],
  providers: [
    AttendanceService,
    AttendanceRulesService,
    AttendanceConfigService,
    OfficialHolidaysService,
    RegularizationService,
    AttendancePeriodsService,
    OvertimeService,
    WorkFromHomeService,
    RosterService,
    DevicesService,
    TimesheetsService,
    TimesheetReminderJob,
  ],
  exports: [AttendanceRulesService, TimesheetsService],
})
export class AttendanceModule {}
