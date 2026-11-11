import { Global, Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

/** Calendar invites (.ics) for leave, interviews and 1:1s, and personal calendar feeds. */
@Global()
@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
