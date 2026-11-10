import { fieldContext } from './encryption.service';

/**
 * Every encrypted column, with the context its ciphertext is bound to. The re-encrypt job walks this list, so a new
 * encrypted column must be added here.
 *
 * `plainLegacy`: the column held plain text before it was encrypted; the job encrypts what's still plain.
 * Values that are copied between columns share a context (pending MFA secret → MFA secret, an approved bank change →
 * the employee's account), so they stay readable after the copy.
 */
export interface EncryptedField {
  table: string;
  column: string;
  /** Row column the context is derived from. */
  key: string;
  context: (key: string) => string;
  plainLegacy?: boolean;
}

export const ctx = {
  employee: (column: EmployeeEncryptedColumn, employeeId: string) => fieldContext('employees', column, employeeId),
  mfaSecret: (userId: string) => fieldContext('users', 'mfa_secret', userId),
  grievanceCase: (column: 'details' | 'resolution', caseId: string) => fieldContext('grievance_cases', column, caseId),
  grievanceNote: (noteId: string) => fieldContext('grievance_notes', 'body', noteId),
  offerPrejoining: (offerId: string) => fieldContext('offers', 'prejoining', offerId),
  ssoClientSecret: (organizationId: string) => fieldContext('organization_sso_configs', 'client_secret', organizationId),
  webhookSecret: (endpointId: string) => fieldContext('webhook_endpoints', 'secret', endpointId),
};

export type EmployeeEncryptedColumn =
  | 'pan'
  | 'uan'
  | 'bank_account'
  | 'aadhaar'
  | 'passport'
  | 'address'
  | 'permanent_address'
  | 'emergency_contact_name'
  | 'emergency_contact_phone';

const employee = (column: string, name: EmployeeEncryptedColumn, plainLegacy = false): EncryptedField => ({
  table: 'employees',
  column,
  key: 'id',
  context: (id) => ctx.employee(name, id),
  plainLegacy,
});

export const ENCRYPTED_FIELDS: EncryptedField[] = [
  employee('pan_encrypted', 'pan'),
  employee('uan_encrypted', 'uan'),
  employee('bank_account_encrypted', 'bank_account'),
  employee('aadhaar_encrypted', 'aadhaar'),
  employee('passport_encrypted', 'passport'),
  employee('address', 'address', true),
  employee('permanent_address', 'permanent_address', true),
  employee('emergency_contact_name', 'emergency_contact_name', true),
  employee('emergency_contact_phone', 'emergency_contact_phone', true),
  { table: 'bank_detail_changes', column: 'account_encrypted', key: 'employee_id', context: (id) => ctx.employee('bank_account', id) },
  { table: 'users', column: 'mfa_secret_enc', key: 'id', context: ctx.mfaSecret },
  { table: 'users', column: 'mfa_pending_secret_enc', key: 'id', context: ctx.mfaSecret },
  { table: 'grievance_cases', column: 'details_encrypted', key: 'id', context: (id) => ctx.grievanceCase('details', id) },
  { table: 'grievance_cases', column: 'resolution_encrypted', key: 'id', context: (id) => ctx.grievanceCase('resolution', id) },
  { table: 'grievance_notes', column: 'body_encrypted', key: 'id', context: ctx.grievanceNote },
  { table: 'offers', column: 'prejoining_encrypted', key: 'id', context: ctx.offerPrejoining },
  { table: 'organization_sso_configs', column: 'client_secret_encrypted', key: 'organization_id', context: ctx.ssoClientSecret },
  { table: 'webhook_endpoints', column: 'secret_encrypted', key: 'id', context: ctx.webhookSecret },
];
