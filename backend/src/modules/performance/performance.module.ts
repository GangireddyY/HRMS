import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { PayrollModule } from '../payroll/payroll.module';
import { CompensationBudgetsService } from './compensation-budgets.service';
import { CyclesService } from './cycles.service';
import { SuccessionService } from './succession.service';
import { HikesController } from './hikes.controller';
import { HikesService } from './hikes.service';
import { OkrsController } from './okrs.controller';
import { OkrsService } from './okrs.service';
import { OneOnOnesService } from './one-on-ones.service';
import { PerformanceController } from './performance.controller';
import { PipsService } from './pips.service';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [EmployeesModule, PayrollModule],
  controllers: [PerformanceController, HikesController, OkrsController],
  providers: [CyclesService, ReviewsService, PipsService, HikesService, OkrsService, OneOnOnesService, CompensationBudgetsService, SuccessionService],
})
export class PerformanceModule {}
