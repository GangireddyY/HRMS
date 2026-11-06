import { diff } from '../infrastructure/audit/audit.service';
import { paginationMeta, resolveSort } from './dto/pagination.dto';
import { AppError } from './errors/app-error';
import { isValidTimeZone } from './validation/validators';

describe('resolveSort', () => {
  type OrderBy = Record<string, 'asc' | 'desc'>;
  const allowed: Record<string, (d: 'asc' | 'desc') => OrderBy> = { name: (d) => ({ name: d }) };

  it('uses the fallback when no sort is given', () => {
    expect(resolveSort(undefined, allowed, { createdAt: 'desc' })).toEqual({ createdAt: 'desc' });
  });

  it('maps whitelisted fields', () => {
    expect(resolveSort('name:asc', allowed, {})).toEqual({ name: 'asc' });
  });

  it('rejects fields outside the whitelist', () => {
    expect(() => resolveSort('passwordHash:asc', allowed, {})).toThrow(AppError);
  });
});

describe('paginationMeta', () => {
  it('computes total pages', () => {
    expect(paginationMeta({ page: 2, pageSize: 20 } as never, 45)).toEqual({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
    expect(paginationMeta({ page: 1, pageSize: 20 } as never, 0).totalPages).toBe(1);
  });
});

describe('audit diff', () => {
  it('records only changed fields', () => {
    expect(diff({ name: 'A', city: 'X' }, { name: 'B', city: 'X' })).toEqual({ name: { from: 'A', to: 'B' } });
  });

  it('redacts sensitive fields', () => {
    expect(diff({ passwordHash: 'a' }, { passwordHash: 'b' })).toEqual({ passwordHash: { from: '[REDACTED]', to: '[REDACTED]' } });
    expect(diff({ mfaSecretEnc: 'a' }, { mfaSecretEnc: 'b' }).mfaSecretEnc.to).toBe('[REDACTED]');
    expect(diff({ pan: 'ABCDE1234F' }, { pan: 'ABCDE1234G' }).pan.to).toBe('[REDACTED]');
  });

  it('does not redact policy or business fields that merely resemble sensitive names', () => {
    expect(diff({ passwordMinLength: 12 }, { passwordMinLength: 16 })).toEqual({ passwordMinLength: { from: 12, to: 16 } });
    expect(diff({ companySize: '1-10' }, { companySize: '11-50' }).companySize.to).toBe('11-50');
  });

  it('ignores undefined values', () => {
    expect(diff({ name: 'A' }, { name: undefined })).toEqual({});
  });
});

describe('isValidTimeZone', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('AppError', () => {
  it('maps codes to HTTP statuses', () => {
    expect(AppError.notFound('Role').status).toBe(404);
    expect(new AppError('ACCOUNT_LOCKED', 'x').status).toBe(423);
    expect(AppError.validation([]).status).toBe(422);
  });
});
