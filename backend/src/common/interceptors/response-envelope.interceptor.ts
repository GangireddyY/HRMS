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

/** Wraps controller return values in the standard success envelope. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
