import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** Establishes the async request context (request id, client metadata) for the whole request. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.get('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    RequestContext.run({ requestId, ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined }, () => next());
  }
}
