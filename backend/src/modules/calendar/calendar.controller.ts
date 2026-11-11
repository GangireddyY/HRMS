import { Controller, Get, Header, HttpCode, NotFoundException, Param, Post, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, Public, RequireTenant } from '../../common/auth/decorators';
import { CalendarService } from './calendar.service';

@ApiTags('Calendar')
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('feed')
  @ApiBearerAuth()
  @RequireTenant()
  @ApiOperation({ summary: 'Whether you have a calendar feed URL' })
  status(@CurrentAuth() auth: AuthContext) {
    return this.calendar.feedStatus(auth);
  }

  @Post('feed')
  @ApiBearerAuth()
  @RequireTenant()
  @HttpCode(200)
  @ApiOperation({ summary: 'A new private feed URL for Google / Outlook / Apple Calendar (the old one stops working); shown once' })
  rotate(@CurrentAuth() auth: AuthContext) {
    return this.calendar.rotateFeed(auth);
  }

  @Post('feed/remove')
  @ApiBearerAuth()
  @RequireTenant()
  @HttpCode(200)
  remove(@CurrentAuth() auth: AuthContext) {
    return this.calendar.removeFeed(auth);
  }

  /** Polled by calendar apps; the secret in the URL is the only credential. */
  @Get('feed/:file')
  @Public()
  @Header('Cache-Control', 'private, max-age=900')
  @ApiOperation({ summary: 'The calendar feed (iCalendar) for a private feed URL' })
  async feed(@Param('file') file: string) {
    const ics = await this.calendar.feed(file.replace(/\.ics$/, ''));
    if (!ics) throw new NotFoundException();
    return new StreamableFile(Buffer.from(ics, 'utf8'), { type: 'text/calendar; charset=utf-8', disposition: 'inline; filename="hrms.ics"' });
  }
}
