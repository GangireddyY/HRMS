import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveModule } from '../leave/leave.module';
import { ExitController } from './exit.controller';
import { ExitsService } from './exits.service';
import { SettlementsService } from './settlements.service';

@Module({
  imports: [EmployeesModule, LeaveModule],
  controllers: [ExitController],
  providers: [ExitsService, SettlementsService],
})
export class ExitModule {}
