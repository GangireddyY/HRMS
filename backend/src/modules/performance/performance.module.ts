import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { PayrollModule } from '../payroll/payroll.module';
import { CyclesService } from './cycles.service';
import { HikesController } from './hikes.controller';
import { HikesService } from './hikes.service';
import { PerformanceController } from './performance.controller';
import { PipsService } from './pips.service';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [EmployeesModule, PayrollModule],
  controllers: [PerformanceController, HikesController],
  providers: [CyclesService, ReviewsService, PipsService, HikesService],
})
export class PerformanceModule {}
