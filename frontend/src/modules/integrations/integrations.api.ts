import { http } from '@/core/http/http-client';
import type { ApiKeyRow, GrantablePermission, WebhookDelivery, WebhookDetail, WebhookInput, WebhookRow } from './types';

export const integrationsApi = {
  apiKeys: () => http.get<ApiKeyRow[]>('/integrations/api-keys'),
  grantable: () => http.get<GrantablePermission[]>('/integrations/api-keys/permissions'),
  createApiKey: (body: { name: string; permissions: string[]; expiresAt?: string | null }) => http.post<ApiKeyRow & { key: string }>('/integrations/api-keys', body),
  revokeApiKey: (id: string) => http.post<{ revoked: boolean }>(`/integrations/api-keys/${id}/revoke`),

  events: () => http.get<{ groups: { key: string; label: string; pattern: string }[]; excluded: string[] }>('/integrations/webhooks/events'),
  webhooks: () => http.get<WebhookRow[]>('/integrations/webhooks'),
  webhook: (id: string) => http.get<WebhookDetail>(`/integrations/webhooks/${id}`),
  createWebhook: (body: WebhookInput) => http.post<WebhookRow & { secret?: string }>('/integrations/webhooks', body),
  updateWebhook: (id: string, body: Partial<WebhookInput>) => http.patch<WebhookDetail>(`/integrations/webhooks/${id}`, body),
  removeWebhook: (id: string) => http.delete<{ deleted: boolean }>(`/integrations/webhooks/${id}`),
  rotateSecret: (id: string) => http.post<WebhookRow & { secret: string }>(`/integrations/webhooks/${id}/rotate-secret`),
  testWebhook: (id: string) => http.post<WebhookDelivery>(`/integrations/webhooks/${id}/test`),
  redeliver: (id: string, deliveryId: string) => http.post<WebhookDelivery>(`/integrations/webhooks/${id}/deliveries/${deliveryId}/redeliver`),
};
