import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RbacModule } from '../rbac/rbac.module';
import { CandidatesService } from './candidates.service';
import { CareersService } from './careers.service';
import { JobsService } from './jobs.service';
import { OffersService } from './offers.service';
import { PipelineService } from './pipeline.service';
import { OfferPortalService } from './offer-portal.service';
import { CareersController, OfferPortalController, RecruitmentController } from './recruitment.controller';
import { RequisitionsService } from './requisitions.service';

@Module({
  imports: [EmployeesModule, OnboardingModule, RbacModule],
  controllers: [RecruitmentController, CareersController, OfferPortalController],
  providers: [RequisitionsService, JobsService, CandidatesService, PipelineService, OffersService, CareersService, OfferPortalService],
  exports: [RequisitionsService],
})
export class RecruitmentModule {}
