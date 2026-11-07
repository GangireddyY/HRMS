import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveModule } from '../leave/leave.module';
import { AlumniService } from './alumni.service';
import { AlumniController, ExitController } from './exit.controller';
import { ExitLettersService } from './exit-letters.service';
import { ExitsService } from './exits.service';
import { SettlementsService } from './settlements.service';

@Module({
  imports: [EmployeesModule, LeaveModule],
  controllers: [ExitController, AlumniController],
  providers: [ExitsService, SettlementsService, ExitLettersService, AlumniService],
})
export class ExitModule {}
