import { registerDecorator, ValidationOptions } from 'class-validator';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validates an IANA time zone identifier, e.g. `Asia/Kolkata`. */
export function IsTimeZone(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a valid IANA time zone`, ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && isValidTimeZone(value) },
    });
  };
}
