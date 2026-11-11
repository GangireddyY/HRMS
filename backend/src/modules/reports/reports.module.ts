import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportBuilderService } from './builder/report-builder.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportSchedulesService } from './schedules/report-schedules.service';

@Module({
  imports: [EmployeesModule, RbacModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportBuilderService, ReportSchedulesService],
  exports: [ReportSchedulesService],
})
export class ReportsModule {}
