import { ref } from 'vue';
import { openStream } from '@/core/http/http-client';

/**
 * Live updates from the API's event stream (`/notifications/stream`): when something new arrives for the user, the
 * listeners refresh what they show (notification badge, approval counts). Reconnects with backoff; when the stream
 * is down, `connected` is false and widgets fall back to polling while the tab is visible.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
export const liveConnected = ref(false);

let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let users = 0;

export function onLiveUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts the stream (reference-counted: the shell starts it once per signed-in layout). */
export function startLiveUpdates(): () => void {
  users++;
  if (users === 1) void connect();
  return () => {
    users = Math.max(0, users - 1);
    if (!users) stop();
  };
}

function stop() {
  clearTimeout(retryTimer);
  controller?.abort();
  controller = null;
  liveConnected.value = false;
}

function scheduleRetry() {
  if (!users) return;
  liveConnected.value = false;
  const delay = Math.min(60_000, 2_000 * 2 ** attempt++) + Math.random() * 1000;
  retryTimer = setTimeout(() => void connect(), delay);
}

async function connect() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const res = await openStream('/notifications/stream', signal);
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Events are separated by a blank line; only the event name matters.
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = /^event: (\w+)/m.exec(buffer.slice(0, end))?.[1];
        buffer = buffer.slice(end + 2);
        if (event === 'ready') {
          liveConnected.value = true;
          attempt = 0;
        } else if (event === 'notification') {
          for (const l of [...listeners]) l();
        }
      }
    }
  } catch {
    if (signal.aborted) return;
  }
  if (!signal.aborted) scheduleRetry();
}
