import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AnnouncementsService } from './announcements.service';
import { EngagementController } from './engagement.controller';
import { RecognitionService } from './recognition.service';
import { SurveysService } from './surveys.service';

@Module({
  imports: [EmployeesModule],
  controllers: [EngagementController],
  providers: [AnnouncementsService, SurveysService, RecognitionService],
})
export class EngagementModule {}
