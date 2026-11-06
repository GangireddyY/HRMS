import { reactive, ref, shallowRef, watch, type Ref } from 'vue';
import type { PaginationMeta } from '@contracts';
import type { Page, Query } from '@/core/http/http-client';

export interface TableQuery extends Query {
  page: number;
  pageSize: number;
  sort?: string;
  search?: string;
}

/**
 * Server-side table state: pagination, sorting, debounced search and filters.
 * Stale responses (from superseded requests) are ignored.
 */
export function useTable<Row, F extends Query = Query>(
  fetcher: (q: TableQuery & F) => Promise<Page<Row>>,
  options: { pageSize?: number; sort?: string; filters?: F; immediate?: boolean } = {},
) {
  const rows = shallowRef<Row[]>([]) as Ref<Row[]>;
  const meta = ref<PaginationMeta | null>(null);
  const loading = ref(false);
  const error = ref<unknown>(null);
  const page = ref(1);
  const pageSize = ref(options.pageSize ?? 20);
  const sort = ref<string | undefined>(options.sort);
  const search = ref('');
  const filters = reactive({ ...(options.filters ?? {}) }) as F;
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

  watch([page, sort], () => void load());
  watch(
    () => ({ ...(filters as object) }),
    () => {
      if (page.value !== 1) page.value = 1;
      else void load();
    },
    { deep: true },
  );
  watch(search, () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (page.value !== 1) page.value = 1;
      else void load();
    }, 300);
  });

  if (options.immediate !== false) void load();

  return { rows, meta, loading, error, page, pageSize, sort, search, filters, load, setPage };
}
