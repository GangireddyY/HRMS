import type { WebhookFormat } from '@contracts';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface GrantablePermission {
  key: string;
  description: string;
  scope: string;
}

export interface WebhookRow {
  id: string;
  /** Masked for Slack and Teams (their URL is a credential). */
  url: string;
  format: WebhookFormat;
  description: string | null;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface WebhookDetail extends WebhookRow {
  deliveries: WebhookDelivery[];
}

export interface WebhookInput {
  url?: string;
  format?: WebhookFormat;
  description?: string | null;
  events: string[];
  enabled?: boolean;
}

/** Live check against Vector: Access off / wrong key → off; Vector down → unreachable. */
export type VectorRemoteStatus = 'live' | 'off' | 'unreachable' | 'unknown';

export interface VectorConnectorSettings {
  configured: boolean;
  enabled: boolean;
  apiBaseUrl: string | null;
  appOrigin: string | null;
  publishableKey: string | null;
  hasSecretKey: boolean;
  secretPrefix: string | null;
  allowedRoleIds: string[];
  deniedUserIds: string[];
  remoteStatus: VectorRemoteStatus;
  vectorOrgName: string | null;
  vectorOrgSlug: string | null;
  lastConnectedAt: string | null;
  updatedAt: string | null;
}

export interface VectorAccessPerson {
  userId: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  via: 'role' | 'admin' | 'both';
  roleNames: string[];
  removable: boolean;
}

export interface VectorAccessList {
  people: VectorAccessPerson[];
  denied: VectorAccessPerson[];
}

export interface VectorAccessStatus {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  remoteStatus: VectorRemoteStatus;
  vectorOrgName: string | null;
}

export interface VectorConnectResult {
  embedUrl: string;
  organization: { id: string; name: string; slug: string } | null;
  user: { id: string; name: string; email: string; role: string } | null;
}
