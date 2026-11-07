import type { Router } from 'vue-router';

/**
 * Forms open as pages over the current screen, and the browser's Back button closes them:
 * - opening a form page adds a history entry for the same address, so Back returns to the screen underneath
 *   (the router sees a navigation to the same place) and the top form closes;
 * - closing it another way (Cancel, saving) takes that entry off again, unless the app is navigating —
 *   navigating away while a form page is open replaces the entry instead of adding one after it.
 */
const KEY = '__formPage';

interface Entry {
  id: number;
  close: () => void;
  /** Our history entry exists and hasn't been left yet. */
  pushed: boolean;
  href: string;
}

const stack: Entry[] = [];
let nextId = 1;
let popping = false;
let selfBack = false;
let navigating = false;
let installed = false;
/** A form page that just closed while its history entry is still the current one. */
let closing: Entry | null = null;

// vue-router runs its guards synchronously from its own popstate listener, so this one has to run first: it is
// registered when the module loads (before the router creates its history) and in the capture phase.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'popstate',
    (e) => {
      popping = true;
      setTimeout(() => (popping = false), 0);
      if (selfBack) {
        selfBack = false;
        return;
      }
      const top = stack.at(-1);
      if (top?.pushed && (e.state as Record<string, unknown> | null | undefined)?.[KEY] !== top.id) {
        top.pushed = false;
        top.close();
      }
    },
    { capture: true },
  );
}

export function installFormPages(router: Router): void {
  if (installed) return;
  installed = true;
  router.beforeEach((to) => {
    if (popping) return true;
    navigating = true;
    const orphaned = closing !== null && current() === closing.id;
    if (stack.some((e) => e.pushed) || orphaned) {
      for (const e of stack) e.pushed = false;
      closing = null;
      return { path: to.path, query: to.query, hash: to.hash, replace: true };
    }
    return true;
  });
  router.afterEach(() => {
    navigating = false;
  });
  router.onError(() => {
    navigating = false;
  });
}

/** Registers an open form page; returns the function to call when it closes. */
export function openFormPage(close: () => void): () => void {
  const entry: Entry = { id: nextId++, close, pushed: true, href: location.href };
  history.pushState({ ...history.state, [KEY]: entry.id }, '');
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    if (!entry.pushed) return;
    entry.pushed = false;
    // A navigation started by the same action (e.g. save, then open the new record) replaces the entry instead;
    // otherwise it is taken off after the current task.
    closing = entry;
    setTimeout(() => {
      if (closing === entry) closing = null;
      if (navigating || current() !== entry.id || location.href !== entry.href) return;
      selfBack = true;
      history.back();
    }, 0);
  };
}

function current(): unknown {
  return (history.state as Record<string, unknown> | null)?.[KEY];
}
