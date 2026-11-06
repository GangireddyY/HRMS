import { ValidationError, ValidationPipe } from '@nestjs/common';
import type { ValidationIssue } from '../../contracts';
import { AppError } from '../errors/app-error';

function flatten(errors: ValidationError[], parent = ''): ValidationIssue[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Global DTO validation: strips unknown fields, rejects non-whitelisted ones, transforms types. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => AppError.validation(flatten(errors)),
  });
}
