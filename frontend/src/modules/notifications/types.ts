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
  muted: string[];
  categories: { key: string; label: string; description: string }[];
}
