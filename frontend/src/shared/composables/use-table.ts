import { computed, getCurrentScope, inject, onScopeDispose, reactive, ref, shallowRef, watch, type Ref } from 'vue';
import { routerKey, type LocationQuery, type Router } from 'vue-router';
import type { PaginationMeta } from '@contracts';
import type { Page, Query } from '@/core/http/http-client';

export interface TableQuery extends Query {
  page: number;
  pageSize: number;
  sort?: string;
  search?: string;
}

/** URL values come back as strings; numbers and booleans are restored so selects and toggles match. */
function parseValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d{1,9}$/.test(value)) return Number(value);
  return value;
}

/**
 * Server-side table state: pagination, sorting, debounced search and filters. Stale responses (from superseded
 * requests) are ignored.
 *
 * The state is kept in the address (`?q=…&status=…&sort=…&page=2`), so reloading, going Back to the list and
 * sharing a link all show the same view. Defaults are left out of the address. Pages with more than one table
 * give each a `url` prefix (or `false` to keep a secondary table out of the address).
 */
export function useTable<Row, F extends Query = Query>(
  fetcher: (q: TableQuery & F) => Promise<Page<Row>>,
  options: { pageSize?: number; sort?: string; filters?: F; immediate?: boolean; url?: string | boolean; scope?: string[] } = {},
) {
  const router = options.url === false ? null : inject<Router | null>(routerKey, null);
  const prefix = typeof options.url === 'string' && options.url ? `${options.url}.` : '';
  const key = (k: string) => `${prefix}${k}`;
  const defaults = { ...(options.filters ?? {}) } as Record<string, unknown>;
  const initial: LocationQuery = router?.currentRoute.value.query ?? {};
  const fromUrl = (k: string): string | undefined => {
    const v = initial[key(k)];
    return typeof v === 'string' && v !== '' ? v : undefined;
  };

  const rows = shallowRef<Row[]>([]) as Ref<Row[]>;
  const meta = ref<PaginationMeta | null>(null);
  const loading = ref(false);
  const error = ref<unknown>(null);
  const page = ref(Math.max(1, Number(fromUrl('page')) || 1));
  const pageSize = ref(options.pageSize ?? 20);
  const sort = ref<string | undefined>(fromUrl('sort') ?? options.sort);
  const search = ref(fromUrl('q') ?? '');
  const startFilters: Record<string, unknown> = { ...defaults };
  for (const k of Object.keys(initial)) {
    if (!k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (['page', 'sort', 'q'].includes(name) || name.includes('.')) continue;
    if (!(name in defaults)) continue;
    const v = fromUrl(name);
    startFilters[name] = v === undefined ? undefined : v === '-' ? undefined : parseValue(v);
  }
  const filters = reactive(startFilters) as F;
  let sequence = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const current = ++sequence;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetcher({ ...(filters as object), page: page.value, pageSize: pageSize.value, sort: sort.value, search: search.value.trim() || undefined } as TableQuery & F);
      if (current !== sequence) return;
      rows.value = result.items;
      meta.value = result.meta;
    } catch (e) {
      if (current !== sequence) return;
      error.value = e;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  function setPage(p: number) {
    page.value = p;
  }

  // Never touch the address once the user is leaving this page: a late, debounced update would cancel the navigation.
  const ownerPath = router?.currentRoute.value.path;
  let leaving = false;
  if (router) {
    const offBefore = router.beforeEach((to) => {
      if (to.path !== ownerPath) leaving = true;
    });
    const offAfter = router.afterEach((to, _from, failure) => {
      if (failure || to.path === ownerPath) leaving = false;
    });
    if (getCurrentScope())
      onScopeDispose(() => {
        offBefore();
        offAfter();
        clearTimeout(searchTimer);
      });
  }

  /** Mirrors the state into the address; `-` marks a filter cleared from a non-empty default. */
  function syncUrl() {
    if (!router || leaving || router.currentRoute.value.path !== ownerPath) return;
    const current = router.currentRoute.value;
    const query: LocationQuery = { ...current.query };
    const set = (k: string, v: string | undefined) => {
      if (v === undefined) delete query[key(k)];
      else query[key(k)] = v;
    };
    set('page', page.value > 1 ? String(page.value) : undefined);
    set('sort', sort.value && sort.value !== options.sort ? sort.value : undefined);
    set('q', search.value.trim() || undefined);
    for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
      if (v === defaults[k] || (v === undefined && defaults[k] === undefined)) set(k, undefined);
      else set(k, v === undefined || v === null || v === '' ? '-' : String(v));
    }
    if (JSON.stringify(query) === JSON.stringify(current.query)) return;
    void router.replace({ query }).catch(() => undefined);
  }

  watch([page, sort], () => {
    syncUrl();
    void load();
  });
  watch(
    () => ({ ...(filters as object) }),
    () => {
      if (page.value !== 1) page.value = 1;
      else {
        syncUrl();
        void load();
      }
    },
    { deep: true },
  );
  watch(search, () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (page.value !== 1) page.value = 1;
      else {
        syncUrl();
        void load();
      }
    }, 300);
  });

  /** A search or a filter other than the defaults is narrowing the list. */
  // Scope keys (which list you are looking at, e.g. `view: 'approve' | 'all'`) are not filters: an empty scope says
  // "nothing here", not "no matches", and Clear filters leaves them alone.
  const scope = new Set(options.scope ?? ['view']);
  const isFiltered = computed(
    () => !!search.value.trim() || Object.entries(filters as Record<string, unknown>).some(([k, v]) => !scope.has(k) && v !== defaults[k] && !(v == null && defaults[k] == null)),
  );
  function clearFilters() {
    search.value = '';
    for (const [k, v] of Object.entries(defaults)) if (!scope.has(k)) (filters as Record<string, unknown>)[k] = v;
  }

  if (options.immediate !== false) void load();

  return { rows, meta, loading, error, page, pageSize, sort, search, filters, isFiltered, load, setPage, clearFilters };
}
