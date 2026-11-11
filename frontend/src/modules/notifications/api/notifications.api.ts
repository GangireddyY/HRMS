import { http, type ListQuery } from '@/core/http/http-client';
import type { NotificationEmailSettings, NotificationRow, PushStatus } from '../types';

export const notificationsApi = {
  list: (q: ListQuery & { unreadOnly?: boolean }) => http.page<NotificationRow>('/notifications', q),
  unreadCount: () => http.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => http.post<{ id: string }>(`/notifications/${id}/read`),
  markAllRead: () => http.post<{ updated: number }>('/notifications/read-all'),
  settings: () => http.get<NotificationEmailSettings>('/notifications/settings'),
  saveSettings: (body: { email: boolean; muted: string[]; push?: boolean }) => http.put<NotificationEmailSettings>('/notifications/settings', body),
  pushStatus: () => http.get<PushStatus>('/notifications/push'),
  subscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) => http.post<PushStatus>('/notifications/push/subscriptions', body),
  unsubscribe: (endpoint: string) => http.post<PushStatus>('/notifications/push/unsubscribe', { endpoint }),
};
