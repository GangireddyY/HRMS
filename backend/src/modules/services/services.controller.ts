import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ModuleKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { AssetsService } from './assets.service';
import { HelpdeskService } from './helpdesk.service';
import {
  AssetDto,
  AssetQueryDto,
  AssetRequestDto,
  AssetRequestQueryDto,
  AssetStatusDto,
  AssignAssetDto,
  FulfilAssetRequestDto,
  NoteDto,
  OptionalNoteDto,
  ReturnAssetDto,
  TicketDto,
  TicketQueryDto,
  TicketRatingDto,
  TicketReplyDto,
  TicketUpdateDto,
  TravelDeskDto,
  TravelQueryDto,
  TravelRequestDto,
  UpdateAssetDto,
} from './services.dto';
import { TravelService } from './travel.service';

const UUID = new ParseUUIDPipe();

/** The module is enabled and the caller holds (or was delegated) at least one of the permissions. */
function requireAny(auth: AuthContext, module: ModuleKey, ...permissions: string[]) {
  if (!auth.features.has(module)) throw AppError.forbidden('This module is not enabled for your organization');
  const has = (p: string) => auth.permissions.has(p) || (auth.delegated ?? []).some((g) => g.permission === p);
  if (!permissions.some(has)) throw AppError.forbidden();
}

/** Only the module check; the service decides per request (approval-chain approvers may hold no travel permission). */
function requireModule(auth: AuthContext, module: ModuleKey) {
  if (!auth.features.has(module)) throw AppError.forbidden('This module is not enabled for your organization');
}

@ApiTags('Assets')
@ApiBearerAuth()
@Controller({ path: 'assets', version: '1' })
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('mine')
  @RequirePermissions('assets.request')
  @ApiOperation({ summary: 'Assets you hold and your requests' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.assets.mine(auth);
  }

  @Post('assignments/:id/acknowledge')
  @HttpCode(200)
  @RequirePermissions('assets.request')
  @ApiOperation({ summary: 'Confirm you received an asset' })
  acknowledge(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.assets.acknowledge(auth, id);
  }

  @Get('requests')
  @RequireTenant()
  @ApiOperation({ summary: 'Your asset requests, or everyone’s (view=all, assets.manage)' })
  requests(@CurrentAuth() auth: AuthContext, @Query() query: AssetRequestQueryDto) {
    requireAny(auth, 'assets', 'assets.request', 'assets.manage');
    return this.assets.requests(auth, query);
  }

  @Post('requests')
  @RequirePermissions('assets.request')
  @ApiOperation({ summary: 'Ask for an asset' })
  request(@CurrentAuth() auth: AuthContext, @Body() dto: AssetRequestDto) {
    return this.assets.requestAsset(auth, dto);
  }

  @Post('requests/:id/fulfil')
  @HttpCode(200)
  @RequirePermissions('assets.manage')
  @ApiOperation({ summary: 'Hand an in-stock asset to the requester' })
  fulfil(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FulfilAssetRequestDto) {
    return this.assets.fulfil(auth, id, dto);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @RequirePermissions('assets.manage')
  rejectRequest(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: NoteDto) {
    return this.assets.reject(auth, id, dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('assets.request')
  cancelRequest(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.assets.cancelRequest(auth, id);
  }

  @Get('summary')
  @RequirePermissions('assets.manage')
  summary(@CurrentAuth() auth: AuthContext) {
    return this.assets.summary(auth);
  }

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'The asset register (assets.manage), or what your people hold (assets.view)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: AssetQueryDto) {
    requireAny(auth, 'assets', 'assets.view', 'assets.manage');
    return this.assets.list(auth, query);
  }

  @Post()
  @RequirePermissions('assets.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: AssetDto) {
    return this.assets.create(auth, dto);
  }

  @Get(':id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'assets', 'assets.view', 'assets.manage');
    return this.assets.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('assets.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(auth, id, dto);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('assets.manage')
  assign(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AssignAssetDto) {
    return this.assets.assign(auth, id, dto);
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermissions('assets.manage')
  @ApiOperation({ summary: 'Take an asset back, recording its condition' })
  returnAsset(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReturnAssetDto) {
    return this.assets.returnAsset(auth, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions('assets.manage')
  @ApiOperation({ summary: 'Mark in stock, in repair, retired or lost' })
  status(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AssetStatusDto) {
    return this.assets.setStatus(auth, id, dto);
  }
}

@ApiTags('Helpdesk')
@ApiBearerAuth()
@Controller({ path: 'helpdesk/tickets', version: '1' })
export class HelpdeskController {
  constructor(private readonly helpdesk: HelpdeskService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Your tickets, or the queue (view=queue, helpdesk.manage)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: TicketQueryDto) {
    requireAny(auth, 'helpdesk', 'helpdesk.raise', 'helpdesk.manage');
    return this.helpdesk.list(auth, query);
  }

  @Post()
  @RequirePermissions('helpdesk.raise')
  @ApiOperation({ summary: 'Raise a ticket with HR' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: TicketDto) {
    return this.helpdesk.create(auth, dto);
  }

  @Get('stats')
  @RequirePermissions('helpdesk.manage')
  stats(@CurrentAuth() auth: AuthContext) {
    return this.helpdesk.stats(auth);
  }

  @Get('agents')
  @RequirePermissions('helpdesk.manage')
  agents(@CurrentAuth() auth: AuthContext) {
    return this.helpdesk.agents(auth);
  }

  @Get(':id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'helpdesk', 'helpdesk.raise', 'helpdesk.manage');
    return this.helpdesk.get(auth, id);
  }

  @Post(':id/messages')
  @RequireTenant()
  @ApiOperation({ summary: 'Reply on a ticket (agents can add internal notes and set the status)' })
  reply(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: TicketReplyDto) {
    requireAny(auth, 'helpdesk', 'helpdesk.raise', 'helpdesk.manage');
    return this.helpdesk.reply(auth, id, dto);
  }

  @Patch(':id')
  @RequirePermissions('helpdesk.manage')
  @ApiOperation({ summary: 'Agents: status, assignee, priority' })
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: TicketUpdateDto) {
    return this.helpdesk.update(auth, id, dto);
  }

  @Post(':id/rating')
  @HttpCode(200)
  @RequirePermissions('helpdesk.raise')
  @ApiOperation({ summary: 'Rate a resolved ticket (closes it)' })
  rate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: TicketRatingDto) {
    return this.helpdesk.rate(auth, id, dto);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('helpdesk.raise')
  close(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.helpdesk.close(auth, id);
  }
}

@ApiTags('Travel')
@ApiBearerAuth()
@Controller({ path: 'travel/requests', version: '1' })
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Your trips, those you approve (view=team) or all (view=all, travel desk)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: TravelQueryDto) {
    requireModule(auth, 'travel');
    return this.travel.list(auth, query);
  }

  @Post()
  @RequirePermissions('travel.request')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: TravelRequestDto) {
    return this.travel.create(auth, dto);
  }

  @Get(':id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireModule(auth, 'travel');
    return this.travel.get(auth, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireTenant()
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: OptionalNoteDto) {
    return this.travel.approve(auth, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireTenant()
  reject(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: NoteDto) {
    return this.travel.reject(auth, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('travel.request')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.travel.cancel(auth, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequireTenant()
  complete(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'travel', 'travel.request', 'travel.manage');
    return this.travel.complete(auth, id);
  }

  @Put(':id/desk')
  @RequirePermissions('travel.manage')
  @ApiOperation({ summary: 'Travel desk: bookings and the advance payment' })
  desk(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: TravelDeskDto) {
    return this.travel.desk(auth, id, dto);
  }
}
