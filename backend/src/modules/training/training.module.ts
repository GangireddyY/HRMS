import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { TrainingCoursesService } from './training-courses.service';
import { TrainingEnrollmentsService } from './training-enrollments.service';
import { TrainingController } from './training.controller';

@Module({
  imports: [EmployeesModule],
  controllers: [TrainingController, SkillsController],
  providers: [TrainingCoursesService, TrainingEnrollmentsService, SkillsService],
})
export class TrainingModule {}
