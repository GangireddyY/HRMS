import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import type { ApiSuccess, PaginationMeta } from '../../contracts';
import { Observable, map } from 'rxjs';

/** Marker type returned by services for paginated lists. */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}
}

/** Nest's marker for @Sse() handlers (their events are sent as they are). */
const SSE_METADATA = '__sse__';

/** Wraps controller return values in the standard success envelope. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler())) return next.handle();
    return next.handle().pipe(
      map((value): unknown => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof PaginatedResult) {
          const body: ApiSuccess<unknown[]> = { success: true, data: value.items, meta: value.meta };
          return body;
        }
        const body: ApiSuccess<unknown> = { success: true, data: value ?? null };
        return body;
      }),
    );
  }
}
