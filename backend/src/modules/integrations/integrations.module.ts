import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { IntegrationsController } from './integrations.controller';
import { VectorConnectorService } from './vector-connector.service';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [IntegrationsController],
  providers: [ApiKeysService, WebhooksService, VectorConnectorService],
})
export class IntegrationsModule {}
