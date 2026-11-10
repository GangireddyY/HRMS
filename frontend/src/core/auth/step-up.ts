import { reactive } from 'vue';

/**
 * Pending step-up request: the API answered STEP_UP_REQUIRED for a sensitive action (bank file, PF ECR, audit
 * archives). The dialog asks for an authenticator code or the password; the original request is retried after.
 */
export const stepUp = reactive({ open: false, message: '', resolve: null as ((ok: boolean) => void) | null });

let pending: Promise<boolean> | null = null;

export function requestStepUp(message: string): Promise<boolean> {
  // Parallel requests share one prompt.
  pending ??= new Promise<boolean>((resolve) => {
    Object.assign(stepUp, { open: true, message, resolve });
  }).finally(() => {
    pending = null;
  });
  return pending;
}

export function settleStepUp(ok: boolean): void {
  const resolve = stepUp.resolve;
  Object.assign(stepUp, { open: false, message: '', resolve: null });
  resolve?.(ok);
}
