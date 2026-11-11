import { Global, Module } from '@nestjs/common';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationBus, PushService],
  exports: [NotificationsService, NotificationBus, PushService],
})
export class NotificationsModule {}
