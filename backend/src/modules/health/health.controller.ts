import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { DatabaseService } from '../../database/database.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let database: 'up' | 'down' = 'up';
    try {
      await this.db.select('SELECT 1');
    } catch {
      database = 'down';
    }
    if (database === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: database === 'up' ? 'ok' : 'degraded', database, timestamp: new Date().toISOString() };
  }
}
