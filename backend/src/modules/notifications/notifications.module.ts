import { Global, Module } from '@nestjs/common';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { NotificationDigestService } from './digest.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationBus, PushService, WhatsAppService, NotificationDigestService],
  exports: [NotificationsService, NotificationBus, PushService, WhatsAppService, NotificationDigestService],
})
export class NotificationsModule {}
