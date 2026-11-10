import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyDto, UpdateWebhookDto, WebhookDto } from './integrations.dto';
import { WebhooksService } from './webhooks.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---- API keys --------------------------------------------------------------------------------

  @Get('api-keys')
  @RequirePermissions('integration.manage')
  listKeys() {
    return this.keys.list();
  }

  @Get('api-keys/permissions')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'View permissions you can give a key (keys are read-only)' })
  grantable(@CurrentAuth() auth: AuthContext) {
    return this.keys.grantable(auth);
  }

  @Post('api-keys')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Create an API key; the key itself is returned only once' })
  createKey(@CurrentAuth() auth: AuthContext, @Body() dto: ApiKeyDto) {
    return this.keys.create(auth, dto);
  }

  @Post('api-keys/:id/revoke')
  @RequirePermissions('integration.manage')
  revokeKey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.keys.revoke(auth, id);
  }

  // ---- Webhooks --------------------------------------------------------------------------------

  @Get('webhooks/events')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Event groups a webhook can subscribe to' })
  events() {
    return this.webhooks.catalog();
  }

  @Get('webhooks')
  @RequirePermissions('integration.manage')
  listWebhooks() {
    return this.webhooks.list();
  }

  @Post('webhooks')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Add a webhook; the signing secret is returned only once' })
  createWebhook(@CurrentAuth() auth: AuthContext, @Body() dto: WebhookDto) {
    return this.webhooks.create(auth, dto);
  }

  @Get('webhooks/:id')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'The webhook with its 50 latest deliveries' })
  webhook(@Param('id', UUID) id: string) {
    return this.webhooks.get(id);
  }

  @Patch('webhooks/:id')
  @RequirePermissions('integration.manage')
  updateWebhook(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(auth, id, dto);
  }

  @Delete('webhooks/:id')
  @RequirePermissions('integration.manage')
  removeWebhook(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.webhooks.remove(auth, id);
  }

  @Post('webhooks/:id/rotate-secret')
  @RequirePermissions('integration.manage')
  rotate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.webhooks.rotateSecret(auth, id);
  }

  @Post('webhooks/:id/test')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Send a ping now and see the response' })
  test(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.webhooks.test(auth, id);
  }

  @Post('webhooks/:id/deliveries/:deliveryId/redeliver')
  @RequirePermissions('integration.manage')
  redeliver(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('deliveryId', UUID) deliveryId: string) {
    return this.webhooks.redeliver(auth, id, deliveryId);
  }
}
