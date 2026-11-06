import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { ComplianceController } from './compliance.controller';
import { PoliciesService } from './policies.service';

@Module({
  imports: [EmployeesModule],
  controllers: [ComplianceController],
  providers: [PoliciesService, ComplianceCalendarService],
})
export class ComplianceModule {}
