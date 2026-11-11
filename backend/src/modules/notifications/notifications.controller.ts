import { Body, Controller, Get, Headers, HttpCode, type MessageEvent, Param, ParseUUIDPipe, Post, Put, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { EMAIL_DIGESTS, type EmailDigest } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AllowRestrictedSession, Authenticated, CurrentAuth } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { WhatsAppService } from './whatsapp.service';

class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

class NotificationSettingsDto {
  @ApiProperty({ description: 'False turns off all notification emails (security alerts are still sent)' })
  @IsBoolean()
  email: boolean;

  @ApiProperty({ type: [String], description: 'Categories kept in the app only' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  muted: string[];

  @ApiPropertyOptional({ description: 'False turns off browser notifications on every device' })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ enum: EMAIL_DIGESTS, description: 'OFF: email each notification; DAILY / WEEKLY: one summary instead' })
  @IsOptional()
  @IsIn(EMAIL_DIGESTS)
  emailDigest?: EmailDigest;

  @ApiPropertyOptional({ description: 'Local hour (0–23) the summary goes out' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  digestHour?: number;

  @ApiPropertyOptional({ description: 'Weekly summary: ISO weekday, 1 = Monday' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  digestDay?: number;

  @ApiPropertyOptional({ description: 'IANA timezone for the summary, e.g. Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ description: 'WhatsApp messages on or off (needs a confirmed number)' })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional({ description: 'Calendar invites by email for your leave, interviews and 1:1s' })
  @IsOptional()
  @IsBoolean()
  calendarInvites?: boolean;
}

class WhatsAppNumberDto {
  @ApiProperty({ description: 'With country code, e.g. +919876543210' }) @IsString() @MaxLength(24) number: string;
}

class WhatsAppCodeDto {
  @ApiProperty() @IsString() @MaxLength(10) code: string;
}

class PushKeysDto {
  @ApiProperty() @IsString() @MaxLength(200) p256dh: string;
  @ApiProperty() @IsString() @MaxLength(100) auth: string;
}

class PushSubscriptionDto {
  @ApiProperty({ description: 'PushSubscription.endpoint from the browser' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  @MaxLength(1000)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}

class PushEndpointDto {
  @ApiProperty() @IsString() @MaxLength(1000) endpoint: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@AllowRestrictedSession()
@Authenticated()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly bus: NotificationBus,
    private readonly push: PushService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: NotificationQueryDto) {
    return this.notifications.list(auth.userId, auth.organizationId, query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Which notifications are also emailed to you' })
  settings(@CurrentAuth() auth: AuthContext) {
    return this.notifications.settings(auth.userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Choose which notifications are also emailed to you' })
  updateSettings(@CurrentAuth() auth: AuthContext, @Body() dto: NotificationSettingsDto) {
    return this.notifications.updateSettings(auth.userId, dto);
  }

  @Get('push')
  @ApiOperation({ summary: 'Whether browser notifications are available, the VAPID public key and your subscribed devices' })
  pushStatus(@CurrentAuth() auth: AuthContext) {
    return this.push.status(auth.userId);
  }

  @Post('push/subscriptions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn on browser notifications for this browser' })
  subscribe(@CurrentAuth() auth: AuthContext, @Body() dto: PushSubscriptionDto, @Headers('user-agent') userAgent?: string) {
    return this.push.subscribe(auth.userId, dto, userAgent);
  }

  @Post('push/unsubscribe')
  @HttpCode(200)
  unsubscribe(@CurrentAuth() auth: AuthContext, @Body() dto: PushEndpointDto) {
    return this.push.unsubscribe(auth.userId, dto.endpoint);
  }

  @Post('whatsapp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a 6-digit code to this WhatsApp number (3 per hour); it becomes yours once confirmed' })
  async whatsappVerify(@CurrentAuth() auth: AuthContext, @Body() dto: WhatsAppNumberDto) {
    await this.whatsapp.startVerification(auth.userId, dto.number);
    return this.notifications.settings(auth.userId);
  }

  @Post('whatsapp/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the number with the code sent to it; WhatsApp messages switch on' })
  async whatsappConfirm(@CurrentAuth() auth: AuthContext, @Body() dto: WhatsAppCodeDto) {
    await this.whatsapp.confirm(auth.userId, dto.code.trim());
    return this.notifications.settings(auth.userId);
  }

  @Post('whatsapp/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove your WhatsApp number (messages stop)' })
  async whatsappRemove(@CurrentAuth() auth: AuthContext) {
    await this.whatsapp.remove(auth.userId);
    return this.notifications.settings(auth.userId);
  }

  @Get('unread-count')
  async unreadCount(@CurrentAuth() auth: AuthContext) {
    return { count: await this.notifications.unreadCount(auth.userId, auth.organizationId) };
  }

  /**
   * Server-sent events: `notification` when something new arrives for the user (no content — the client refreshes
   * its own count), `ping` every 25 s to keep proxies from closing the connection.
   */
  @Sse('stream')
  @SkipThrottle()
  stream(@CurrentAuth() auth: AuthContext): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: 'ready', data: {} } as MessageEvent);
      const unsubscribe = this.bus.subscribe(auth.userId, () => subscriber.next({ type: 'notification', data: {} } as MessageEvent));
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: {} } as MessageEvent), 25_000);
      return () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(auth.userId, auth.organizationId, id);
    return { id };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentAuth() auth: AuthContext) {
    return { updated: await this.notifications.markAllRead(auth.userId, auth.organizationId) };
  }
}
