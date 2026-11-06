import type { PasswordPolicy } from '@contracts';

export interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  mfaVerified: boolean;
  current: boolean;
  organization: { id: string; name: string } | null;
}

export interface TokenInspection {
  valid: true;
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string | null;
  existingAccount: boolean;
  passwordPolicy: PasswordPolicy;
}

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}
