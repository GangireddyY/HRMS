import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useTable } from './use-table';

function setup(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/list', component: { render: () => null } }] });
  const fetcher = vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));
  let table!: ReturnType<typeof useTable<unknown, { status?: string; year?: number }>>;
  const Host = defineComponent({
    setup() {
      table = useTable(fetcher, { filters: { status: 'PENDING' as string | undefined, year: undefined as number | undefined }, sort: 'name:asc' });
      return () => h('div');
    },
  });
  return { router, fetcher, Host, get table() { return table; }, async mount() { await router.push(path); await router.isReady(); mount(Host, { global: { plugins: [router] } }); await nextTick(); } };
}

describe('useTable address sync', () => {
  it('starts from the address: search, filters, sort and page', async () => {
    const s = setup('/list?q=asha&status=APPROVED&year=2026&sort=joined:desc&page=3');
    await s.mount();
    expect(s.table.search.value).toBe('asha');
    expect(s.table.filters).toMatchObject({ status: 'APPROVED', year: 2026 });
    expect(s.table.sort.value).toBe('joined:desc');
    expect(s.table.page.value).toBe(3);
    expect(s.fetcher).toHaveBeenCalledWith(expect.objectContaining({ search: 'asha', status: 'APPROVED', year: 2026, page: 3, sort: 'joined:desc' }));
  });

  it('writes changes back, leaving defaults out and marking a cleared default', async () => {
    const s = setup('/list?tab=team');
    await s.mount();
    s.table.filters.status = undefined;
    await nextTick();
    await new Promise((r) => setTimeout(r));
    expect(s.router.currentRoute.value.query).toEqual({ tab: 'team', status: '-' });

    s.table.filters.status = 'PENDING';
    await nextTick();
    await new Promise((r) => setTimeout(r));
    s.table.setPage(2);
    await nextTick();
    await new Promise((r) => setTimeout(r));
    expect(s.router.currentRoute.value.query).toEqual({ tab: 'team', page: '2' });
  });
});
