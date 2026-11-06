import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth-context';
import { AllowRestrictedSession, CurrentAuth } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';

class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  unreadOnly?: boolean;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@AllowRestrictedSession()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: NotificationQueryDto) {
    return this.notifications.list(auth.userId, auth.organizationId, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentAuth() auth: AuthContext) {
    return { count: await this.notifications.unreadCount(auth.userId, auth.organizationId) };
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
