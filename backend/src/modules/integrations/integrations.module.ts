import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { IntegrationsController } from './integrations.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [IntegrationsController],
  providers: [ApiKeysService, WebhooksService],
})
export class IntegrationsModule {}
