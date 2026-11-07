import { computed, readonly, ref } from 'vue';

const DESKTOP_QUERY = '(min-width: 1024px)';
const STANDALONE_QUERY = '(display-mode: standalone)';

function media(query: string) {
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
  const matches = ref(list?.matches ?? true);
  list?.addEventListener('change', (e) => (matches.value = e.matches));
  return matches;
}

// One listener per query for the whole app.
const desktop = media(DESKTOP_QUERY);
const standalone = media(STANDALONE_QUERY);

/**
 * Single source of truth for the layout split: desktop (≥ 1024px) gets the sidebar workspace; phones and tablets get
 * the app layout with a top bar and a bottom tab bar.
 */
export function useDevice() {
  return {
    isDesktop: readonly(desktop),
    isMobile: computed(() => !desktop.value),
    isStandalone: readonly(standalone),
  };
}
