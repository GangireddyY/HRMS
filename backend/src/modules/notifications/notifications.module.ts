import { Global, Module } from '@nestjs/common';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationBus],
  exports: [NotificationsService, NotificationBus],
})
export class NotificationsModule {}
