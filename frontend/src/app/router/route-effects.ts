import { nextTick } from 'vue';
import type { Router } from 'vue-router';

/**
 * What happens around a navigation in the app shell:
 * - Scroll: pages scroll inside `#main`, not the window, so positions are remembered per history entry and restored on
 *   Back / Forward (waiting briefly for the page's data to render); new pages start at the top.
 * - Focus and announcement: after moving to another page, focus goes to its heading and the title is announced to
 *   screen readers, as a full page load would.
 * - Stale chunks: after a deploy, an open tab can request page code that no longer exists; the app then reloads once
 *   at the address being opened instead of failing silently.
 */
const positions = new Map<string, number>();
const MAX_POSITIONS = 200;
const RELOAD_KEY = 'hrms.chunkReloadAt';

const main = () => document.getElementById('main');

// Back / Forward. The router's own popstate listener runs the whole navigation (guards included) before later
// listeners see the event, so this one is registered at load time in the capture phase to run first.
let popped = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => (popped = true), { capture: true });
const entryKey = () => `${(history.state as { position?: number } | null)?.position ?? 0}|${location.pathname}${location.search}`;

let frame = 0;
function remember() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const el = main();
    if (!el) return;
    positions.set(entryKey(), el.scrollTop);
    if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value!);
  });
}

/** Restores once the content is tall enough, trying for about a second while data loads. */
function restore(top: number) {
  const started = performance.now();
  const step = () => {
    const el = main();
    if (!el) return;
    if (el.scrollHeight - el.clientHeight >= top || performance.now() - started > 1000) {
      el.scrollTop = top;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let announcer: HTMLElement | null = null;
function announce(text: string) {
  if (!announcer) {
    announcer = Object.assign(document.createElement('div'), { id: 'route-announcer', className: 'sr-only' });
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.append(announcer);
  }
  announcer.textContent = '';
  setTimeout(() => announcer && (announcer.textContent = text), 50);
}

/** Focuses the page heading, waiting up to ~1 s for pages that render it once their data has loaded. */
function focusPage(path: string, tries = 10) {
  const root = main();
  // A dialog or form page opened by the new page keeps its own focus; so does anything the user focused meanwhile.
  if (!root || location.pathname !== path || document.querySelector('[role="dialog"]')) return;
  if (document.activeElement && document.activeElement !== document.body && document.activeElement !== root && root.contains(document.activeElement)) return;
  const heading = root.querySelector<HTMLElement>('h1');
  if (!heading && tries > 0) {
    setTimeout(() => focusPage(path, tries - 1), 100);
    return;
  }
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  (heading ?? root).focus({ preventScroll: true });
}

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(message);
}

export function installRouteEffects(router: Router, appName: string): void {
  document.addEventListener('scroll', (e) => (e.target as HTMLElement | null)?.id === 'main' && remember(), { capture: true, passive: true });

  let back = false;
  router.beforeEach(() => {
    back = popped;
    popped = false;
  });

  router.afterEach(async (to, from, failure) => {
    if (failure) return;
    await nextTick();
    const samePage = from.matched.length > 0 && to.path === from.path;
    if (!samePage) {
      const saved = back ? positions.get(entryKey()) : undefined;
      if (saved) restore(saved);
      else {
        const el = main();
        if (el) el.scrollTop = 0;
      }
    }
    // First load: the browser announces the document itself.
    if (from.matched.length === 0 || samePage) return;
    announce(to.meta.title ? `${to.meta.title} · ${appName}` : appName);
    setTimeout(() => focusPage(to.path), 0);
  });

  router.onError((error, to) => {
    if (!isChunkLoadError(error)) return;
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.assign(to.fullPath);
  });
}
