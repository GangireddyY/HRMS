import { http, type ListQuery } from '@/core/http/http-client';
import type { NotificationRow } from '../types';

export const notificationsApi = {
  list: (q: ListQuery & { unreadOnly?: boolean }) => http.page<NotificationRow>('/notifications', q),
  unreadCount: () => http.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => http.post<{ id: string }>(`/notifications/${id}/read`),
  markAllRead: () => http.post<{ updated: number }>('/notifications/read-all'),
};
