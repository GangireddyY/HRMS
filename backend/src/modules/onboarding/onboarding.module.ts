import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingCasesService } from './onboarding-cases.service';
import { OnboardingTemplatesService } from './onboarding-templates.service';
import { OnboardingController } from './onboarding.controller';
import { ProbationService } from './probation.service';

@Module({
  imports: [EmployeesModule],
  controllers: [OnboardingController],
  providers: [OnboardingTemplatesService, OnboardingCasesService, ProbationService],
  exports: [OnboardingCasesService],
})
export class OnboardingModule {}
