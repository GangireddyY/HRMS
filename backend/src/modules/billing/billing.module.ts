import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationBillingController, PlatformBillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PlatformBillingController, OrganizationBillingController],
  providers: [BillingService],
})
export class BillingModule {}
