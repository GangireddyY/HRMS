import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [EmployeesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
