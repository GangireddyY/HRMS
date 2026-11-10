import { Body, Controller, Get, HttpCode, type MessageEvent, Param, ParseUUIDPipe, Post, Put, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth-context';
import { AllowRestrictedSession, Authenticated, CurrentAuth } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';

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
