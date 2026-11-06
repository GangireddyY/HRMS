import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { TrainingCoursesService } from './training-courses.service';
import { TrainingEnrollmentsService } from './training-enrollments.service';
import { TrainingController } from './training.controller';

@Module({
  imports: [EmployeesModule],
  controllers: [TrainingController],
  providers: [TrainingCoursesService, TrainingEnrollmentsService],
})
export class TrainingModule {}
