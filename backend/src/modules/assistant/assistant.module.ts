import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveModule } from '../leave/leave.module';
import { AssistantToolsService } from './assistant-tools';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** The AI assistant (opt-in per organization) with permission-checked tools. */
@Module({
  imports: [EmployeesModule, LeaveModule, DashboardModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantToolsService],
})
export class AssistantModule {}
