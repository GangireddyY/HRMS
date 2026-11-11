import type { NotificationSettingsView } from '@contracts';

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export type NotificationEmailSettings = NotificationSettingsView;

export interface PushStatus {
  /** The server has VAPID keys. */
  enabled: boolean;
  publicKey: string | null;
  /** The person's account-wide switch. */
  on: boolean;
  devices: number;
}
