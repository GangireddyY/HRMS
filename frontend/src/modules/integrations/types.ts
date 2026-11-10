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
  url: string;
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
  url: string;
  description?: string | null;
  events: string[];
  enabled?: boolean;
}
