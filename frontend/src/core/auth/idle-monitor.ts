import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** Shared across tabs, so working in one tab keeps the others signed in. */
const ACTIVITY_KEY = 'hrms.lastActivity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Warn this long before the idle limit (WCAG 2.2.1 asks for a way to extend before time runs out). */
export const IDLE_WARNING_MS = 2 * 60_000;

export type IdleState = 'active' | 'warning' | 'expired';

/** Pure state for a given moment; kept separate so it can be unit tested. */
export function idleState(lastActivity: number, now: number, timeoutMs: number, warningMs = IDLE_WARNING_MS): { state: IdleState; remainingMs: number } {
  const remainingMs = Math.max(0, lastActivity + timeoutMs - now);
  if (remainingMs === 0) return { state: 'expired', remainingMs };
  return { state: remainingMs <= Math.min(warningMs, timeoutMs / 2) ? 'warning' : 'active', remainingMs };
}

function readShared(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Tracks activity while signed in. Once the warning starts, only an explicit "Stay signed in" counts, so a
 * stray scroll does not silently dismiss the dialog.
 */
export function useIdleMonitor(timeoutMinutes: Ref<number | null | undefined>, onExpired: () => void) {
  const lastActivity = ref(Date.now());
  const now = ref(Date.now());
  const timeoutMs = computed(() => Math.max(1, timeoutMinutes.value ?? 0) * 60_000);
  const status = computed(() => (timeoutMinutes.value ? idleState(lastActivity.value, now.value, timeoutMs.value) : { state: 'active' as IdleState, remainingMs: Infinity }));
  let lastShared = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let expired = false;

  function record(force = false): void {
    if (!force && status.value.state !== 'active') return;
    const t = Date.now();
    lastActivity.value = t;
    if (t - lastShared > 10_000 || force) {
      lastShared = t;
      try {
        localStorage.setItem(ACTIVITY_KEY, String(t));
      } catch {
        // Storage unavailable: this tab still tracks its own activity.
      }
    }
  }

  const onActivity = () => record();
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACTIVITY_KEY && e.newValue) lastActivity.value = Math.max(lastActivity.value, Number(e.newValue) || 0);
  };

  function tick(): void {
    now.value = Date.now();
    lastActivity.value = Math.max(lastActivity.value, readShared());
    if (status.value.state === 'expired' && !expired) {
      expired = true;
      onExpired();
    }
  }

  onMounted(() => {
    record(true);
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    window.addEventListener('storage', onStorage);
    timer = setInterval(tick, 1000);
  });
  onBeforeUnmount(() => {
    for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true });
    window.removeEventListener('storage', onStorage);
    clearInterval(timer);
  });

  return {
    warning: computed(() => status.value.state === 'warning'),
    remainingMs: computed(() => status.value.remainingMs),
    /** "Stay signed in". */
    extend: () => record(true),
  };
}
