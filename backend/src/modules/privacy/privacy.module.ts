import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { PrivacyRetentionJob } from './privacy-retention.job';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AuthModule, EmployeesModule],
  controllers: [PrivacyController],
  providers: [PrivacyService, PrivacyRetentionJob],
})
export class PrivacyModule {}
