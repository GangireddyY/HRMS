import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { BenefitEnrollmentsService } from './benefit-enrollments.service';
import { BenefitPlansService } from './benefit-plans.service';
import { BenefitsController } from './benefits.controller';

@Module({
  imports: [EmployeesModule],
  controllers: [BenefitsController],
  providers: [BenefitPlansService, BenefitEnrollmentsService],
})
export class BenefitsModule {}
