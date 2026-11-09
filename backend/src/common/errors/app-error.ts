import { HttpStatus } from '@nestjs/common';
import type { ErrorCode, ValidationIssue } from '../../contracts';

const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  ACCOUNT_LOCKED: HttpStatus.LOCKED,
  ACCOUNT_DISABLED: HttpStatus.FORBIDDEN,
  MFA_REQUIRED: HttpStatus.UNAUTHORIZED,
  MFA_INVALID: HttpStatus.UNAUTHORIZED,
  MFA_SETUP_REQUIRED: HttpStatus.FORBIDDEN,
  TOKEN_INVALID: HttpStatus.BAD_REQUEST,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  SESSION_REVOKED: HttpStatus.UNAUTHORIZED,
  PASSWORD_POLICY_VIOLATION: HttpStatus.UNPROCESSABLE_ENTITY,
  PASSWORD_EXPIRED: HttpStatus.FORBIDDEN,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  FEATURE_NOT_ENTITLED: HttpStatus.FORBIDDEN,
  ORGANIZATION_INACTIVE: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  UPSTREAM_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Domain error with a stable machine-readable code. Safe to expose to clients. */
export class AppError extends Error {
  readonly status: HttpStatus;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ValidationIssue[],
  ) {
    super(message);
    this.status = STATUS_BY_CODE[code];
  }

  static notFound(entity: string): AppError {
    return new AppError('NOT_FOUND', `${entity} not found`);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }

  static badRequest(message: string): AppError {
    return new AppError('BAD_REQUEST', message);
  }

  static validation(details: ValidationIssue[], message = 'Validation failed'): AppError {
    return new AppError('VALIDATION_FAILED', message, details);
  }
}
