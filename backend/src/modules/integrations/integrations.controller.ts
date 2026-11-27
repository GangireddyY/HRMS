import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyDto, UpdateWebhookDto, VectorAccessUserDto, VectorConnectDto, VectorConnectorDto, WebhookDto } from './integrations.dto';
import { VectorConnectorService } from './vector-connector.service';
import { WebhooksService } from './webhooks.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly vector: VectorConnectorService,
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

  // ---- Vector workspace embed ------------------------------------------------------------------

  @Get('vector')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Vector workspace embed connector settings' })
  vectorView(@CurrentAuth() auth: AuthContext) {
    return this.vector.view(auth);
  }

  @Get('vector/status')
  @RequireTenant()
  @ApiOperation({ summary: 'Whether the current person may open the Vector workspace' })
  vectorStatus(@CurrentAuth() auth: AuthContext) {
    return this.vector.status(auth);
  }

  @Get('vector/access')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'People who can open Vector, and those individually removed' })
  vectorAccess(@CurrentAuth() auth: AuthContext) {
    return this.vector.listAccess(auth);
  }

  @Post('vector/access/deny')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Remove one person’s Vector access (keeps their HRMS role)' })
  vectorDeny(@CurrentAuth() auth: AuthContext, @Body() dto: VectorAccessUserDto) {
    return this.vector.denyAccess(auth, dto.userId);
  }

  @Post('vector/access/restore')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Restore Vector access for a previously removed person' })
  vectorRestore(@CurrentAuth() auth: AuthContext, @Body() dto: VectorAccessUserDto) {
    return this.vector.restoreAccess(auth, dto.userId);
  }

  @Put('vector')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Save Vector keys and which roles may open the workspace' })
  vectorUpsert(@CurrentAuth() auth: AuthContext, @Body() dto: VectorConnectorDto) {
    return this.vector.upsert(auth, dto);
  }

  @Delete('vector')
  @RequirePermissions('integration.manage')
  @ApiOperation({ summary: 'Remove the Vector connector' })
  vectorRemove(@CurrentAuth() auth: AuthContext) {
    return this.vector.remove(auth);
  }

  @Post('vector/connect')
  @RequireTenant()
  @ApiOperation({ summary: 'Open Vector with the caller’s Vector email/password (returns embedUrl)' })
  vectorConnect(@CurrentAuth() auth: AuthContext, @Body() dto: VectorConnectDto) {
    return this.vector.connect(auth, dto);
  }
}
