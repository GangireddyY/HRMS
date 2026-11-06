import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { EmptyResultError, ForeignKeyConstraintError, UniqueConstraintError } from 'sequelize';
import type { ApiFailure, ErrorCode, ValidationIssue } from '../../contracts';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { RequestContext } from '../context/request-context';

/**
 * Converts every error into the standard failure envelope.
 * Internal details (stack traces, SQL, driver messages) are logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = RequestContext.get()?.requestId;

    const { status, code, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiFailure = { success: false, error: { code, message, details, requestId } };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; code: ErrorCode; message: string; details?: ValidationIssue[] } {
    if (exception instanceof AppError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }

    if (exception instanceof ThrottlerException) {
      return { status: HttpStatus.TOO_MANY_REQUESTS, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' };
    }

    if (exception instanceof UniqueConstraintError) {
      return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'A record with the same unique value already exists' };
    }
    if (exception instanceof ForeignKeyConstraintError) {
      return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'The operation violates a reference constraint' };
    }
    if (exception instanceof EmptyResultError) {
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Record not found' };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === 401 ? 'UNAUTHENTICATED'
        : status === 403 ? 'FORBIDDEN'
        : status === 404 ? 'NOT_FOUND'
        : status === 409 ? 'CONFLICT'
        : status === 429 ? 'RATE_LIMITED'
        : status === 413 ? 'BAD_REQUEST'
        : status < 500 ? 'BAD_REQUEST'
        : 'INTERNAL_ERROR';
      const message = status < 500 ? exception.message : 'An unexpected error occurred';
      return { status, code, message };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
  }
}
