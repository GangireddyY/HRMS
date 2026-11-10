import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AssetsService } from './assets.service';
import { HelpdeskService } from './helpdesk.service';
import { AssetsController, HelpdeskController, TravelController } from './services.controller';
import { TravelService } from './travel.service';

/** Employee services: assets, the HR helpdesk and business travel. */
@Module({
  imports: [EmployeesModule],
  controllers: [AssetsController, HelpdeskController, TravelController],
  providers: [AssetsService, HelpdeskService, TravelService],
})
export class ServicesModule {}
