import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { GrievanceController } from './grievance.controller';
import { GrievancesService } from './grievances.service';

@Module({
  imports: [EmployeesModule],
  controllers: [GrievanceController],
  providers: [GrievancesService],
})
export class GrievanceModule {}
