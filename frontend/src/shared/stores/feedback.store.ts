import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '@/core/http/http-client';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the user must type this text to enable confirmation. */
  requireText?: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let nextId = 1;

/** Toast notifications and confirmation dialogs. */
export const useFeedbackStore = defineStore('feedback', () => {
  const toasts = ref<Toast[]>([]);
  const confirmation = ref<PendingConfirm | null>(null);

  function push(kind: ToastKind, title: string, message?: string, timeoutMs = kind === 'error' ? 8000 : 4500): void {
    const id = nextId++;
    toasts.value.push({ id, kind, title, message });
    setTimeout(() => dismiss(id), timeoutMs);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  const success = (title: string, message?: string) => push('success', title, message);
  const info = (title: string, message?: string) => push('info', title, message);
  const warning = (title: string, message?: string) => push('warning', title, message);
  const error = (title: string, cause?: unknown) => push('error', title, cause === undefined ? undefined : errorMessage(cause));

  function confirm(options: ConfirmOptions): Promise<boolean> {
    confirmation.value?.resolve(false);
    return new Promise((resolve) => {
      confirmation.value = { ...options, resolve };
    });
  }

  function settle(ok: boolean): void {
    confirmation.value?.resolve(ok);
    confirmation.value = null;
  }

  return { toasts, confirmation, success, info, warning, error, dismiss, confirm, settle };
});
