import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { CyclesService } from './cycles.service';
import { PerformanceController } from './performance.controller';
import { PipsService } from './pips.service';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [EmployeesModule],
  controllers: [PerformanceController],
  providers: [CyclesService, ReviewsService, PipsService],
})
export class PerformanceModule {}
