import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveModule } from '../leave/leave.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ServicesModule } from '../services/services.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [EmployeesModule, LeaveModule, PayrollModule, ServicesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
