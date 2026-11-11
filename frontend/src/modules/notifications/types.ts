export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationEmailSettings {
  email: boolean;
  /** Browser notifications on any device. */
  push: boolean;
  muted: string[];
  categories: { key: string; label: string; description: string }[];
}

export interface PushStatus {
  /** The server has VAPID keys. */
  enabled: boolean;
  publicKey: string | null;
  /** The person's account-wide switch. */
  on: boolean;
  devices: number;
}
