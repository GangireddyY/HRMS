<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, inject, ref, watch } from 'vue';
import { routerKey, type Router } from 'vue-router';
import { ArrowDown, ArrowUp, ArrowUpDown, FilterX, LayoutGrid, Rows3, SearchX } from '@lucide/vue';
import AppButton from '@/shared/components/forms/AppButton.vue';
import type { PaginationMeta } from '@contracts';
import AppPagination from '@/shared/components/data/AppPagination.vue';
import AppSegmented from '@/shared/components/forms/AppSegmented.vue';
import AppSelect from '@/shared/components/forms/AppSelect.vue';
import AppEmptyState from '@/shared/components/feedback/AppEmptyState.vue';
import AppErrorState from '@/shared/components/feedback/AppErrorState.vue';
import type { TableColumn } from '@/shared/components/types';

const props = withDefaults(
  defineProps<{
    columns: TableColumn<Row>[];
    rows: Row[];
    rowKey?: (row: Row) => string;
    loading?: boolean;
    error?: unknown;
    sort?: string;
    meta?: PaginationMeta | null;
    emptyTitle?: string;
    emptyDescription?: string;
    clickable?: boolean;
    caption?: string;
    /** A search or filter is narrowing the list: an empty result offers to clear it instead of the empty slot. */
    filtered?: boolean;
    /** Rows can be selected for bulk actions (the `bulk` slot); `canSelect` limits which rows. */
    selectable?: boolean;
    canSelect?: (row: Row) => boolean;
    /** Accessible name of a row's checkbox, e.g. "Select Asha Patel". */
    selectLabel?: (row: Row) => string;
    /** Offer a Table / Grid switch (off for pages with their own layout switch). A `card` slot replaces the default grid card body. */
    grid?: boolean;
    /** Remembers the chosen layout; defaults to the page's route plus the caption. */
    layoutKey?: string;
  }>(),
  { rowKey: (row: Row) => String(row.id), emptyTitle: 'No records found', clickable: false, canSelect: () => true, selectLabel: undefined, grid: true, layoutKey: undefined },
);

const emit = defineEmits<{ 'update:sort': [sort: string]; page: [page: number]; retry: []; rowClick: [row: Row]; clear: [] }>();

const selected = defineModel<string[]>('selected', { default: () => [] });
const selectableRows = computed(() => (props.selectable ? props.rows.filter((r) => props.canSelect(r)) : []));
const allSelected = computed(() => selectableRows.value.length > 0 && selectableRows.value.every((r) => selected.value.includes(props.rowKey(r))));
const someSelected = computed(() => !allSelected.value && selectableRows.value.some((r) => selected.value.includes(props.rowKey(r))));
function toggleRow(row: Row) {
  const k = props.rowKey(row);
  selected.value = selected.value.includes(k) ? selected.value.filter((x) => x !== k) : [...selected.value, k];
}
function toggleAll() {
  selected.value = allSelected.value ? [] : selectableRows.value.map((r) => props.rowKey(r));
}
// Selection only covers rows on screen: drop anything that left (another page, a filter, a completed action).
watch(
  () => props.rows,
  (rows) => {
    if (!selected.value.length) return;
    const keys = new Set(rows.filter((r) => props.canSelect(r)).map((r) => props.rowKey(r)));
    const kept = selected.value.filter((k) => keys.has(k));
    if (kept.length !== selected.value.length) selected.value = kept;
  },
);

function sortState(col: TableColumn<Row>): 'asc' | 'desc' | null {
  if (!col.sortField || !props.sort) return null;
  const [field, dir] = props.sort.split(':');
  return field === col.sortField ? (dir as 'asc' | 'desc') : null;
}

function toggleSort(col: TableColumn<Row>) {
  if (!col.sortField) return;
  const current = sortState(col);
  emit('update:sort', `${col.sortField}:${current === 'asc' ? 'desc' : 'asc'}`);
}

function ariaSort(col: TableColumn<Row>) {
  const s = sortState(col);
  return s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : col.sortField ? 'none' : undefined;
}

/** Logical alignment, so right-to-left languages mirror correctly; figures are right-aligned (`align: 'right'`). */
const align = (col: TableColumn<Row>) => (col.align === 'right' ? 'text-end' : col.align === 'center' ? 'text-center' : 'text-start');

/** Below `md` each row renders as a card: the first column is the card title, the others are label/value pairs. */
function cellClass(col: TableColumn<Row>, index: number) {
  return [
    'px-4 py-2 align-middle text-fg md:table-cell md:h-11',
    align(col),
    col.class,
    index === 0
      ? 'max-md:block max-md:px-0 max-md:pt-0 max-md:pb-1 max-md:text-start'
      : 'max-md:flex max-md:min-h-8 max-md:items-center max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1 max-md:text-end ' +
        'max-md:before:shrink-0 max-md:before:text-start max-md:before:text-xs max-md:before:font-medium max-md:before:text-fg-muted max-md:before:content-[attr(data-label)]',
  ];
}

const sortable = computed(() => props.columns.filter((c) => c.sortField));
const sortOptions = computed(() =>
  sortable.value.flatMap((c) => [
    { value: `${c.sortField}:asc`, label: `${c.label} (ascending)` },
    { value: `${c.sortField}:desc`, label: `${c.label} (descending)` },
  ]),
);

// ---- Table / Grid layout -----------------------------------------------------------------------------------------
const router = inject<Router | null>(routerKey, null);
const storageKey = computed(() => `hrms.layout.${props.layoutKey ?? `${router?.currentRoute.value.matched.at(-1)?.path ?? ''}|${props.caption ?? ''}`}`);
const readLayout = (): 'table' | 'grid' => {
  try {
    return localStorage.getItem(storageKey.value) === 'grid' ? 'grid' : 'table';
  } catch {
    return 'table';
  }
};
const chosen = ref<'table' | 'grid'>(readLayout());
watch(storageKey, () => (chosen.value = readLayout()));
const layout = computed({
  get: () => (props.grid ? chosen.value : 'table'),
  set: (v: 'table' | 'grid') => {
    chosen.value = v;
    try {
      localStorage.setItem(storageKey.value, v);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  },
});
const layoutOptions = [
  { value: 'table' as const, label: 'Table', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];
const hasSortMenu = computed(() => sortOptions.value.length > 0 && props.rows.length > 1);
/** Small screens already show rows as cards, so the switch is for wider screens; the sort menu shows when headers don't. */
const toolbarClass = computed(() => [
  !hasSortMenu.value && 'max-md:hidden',
  !props.grid && !(hasSortMenu.value && layout.value === 'grid') && 'md:hidden',
]);
/** In a card: the first column is the title, labelled columns are details, unlabelled ones (actions) the footer. */
const titleColumn = computed(() => props.columns[0]);
const detailColumns = computed(() => props.columns.slice(1).filter((c) => c.label));
const actionColumns = computed(() => props.columns.slice(1).filter((c) => !c.label));
</script>

<template>
  <div class="overflow-hidden">
    <AppErrorState v-if="error && !loading" :error="error" @retry="emit('retry')" />
    <template v-else>
      <div v-if="hasSortMenu || grid" :class="['flex items-center gap-3 border-b border-line px-3 py-2', toolbarClass]">
        <div v-if="hasSortMenu" :class="['flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted', layout === 'table' && 'md:hidden']">
          <span class="shrink-0 font-medium" aria-hidden="true">Sort by</span>
          <AppSelect
            :model-value="sortOptions.some((o) => o.value === sort) ? sort : undefined"
            :options="sortOptions"
            placeholder="Default order"
            :clearable="false"
            :searchable="false"
            aria-label="Sort by"
            size="sm"
            class="flex-1 md:max-w-60"
            @update:model-value="(v) => v && emit('update:sort', v)"
          />
        </div>
        <AppSegmented v-if="grid" v-model="layout" class="ms-auto w-40 shrink-0 max-md:hidden" size="sm" :options="layoutOptions" :label="caption ? `${caption} layout` : 'Layout'" />
      </div>
      <div v-if="selectable && selected.length" class="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-4 py-2" role="region" aria-label="Bulk actions">
        <p class="me-auto text-sm font-medium text-accent-fg" aria-live="polite">{{ selected.length }} selected</p>
        <slot name="bulk" :selected="selected" :rows="rows.filter((r) => selected.includes(rowKey(r)))" />
        <AppButton size="sm" variant="ghost" @click="selected = []">Clear selection</AppButton>
      </div>
      <div v-if="layout === 'grid'" class="@container" :aria-busy="loading || undefined">
        <ul v-if="loading && rows.length === 0" class="grid gap-3 p-3 @lg:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4" :aria-label="caption ? `Loading ${caption}` : 'Loading'">
          <li v-for="i in 6" :key="`s${i}`" class="card space-y-3 p-4">
            <div class="skeleton h-4 w-2/3 rounded-full" />
            <div v-for="c in detailColumns.slice(0, 4)" :key="c.key" class="flex justify-between gap-4">
              <div class="skeleton h-3 w-1/4 rounded-full" />
              <div class="skeleton h-3 rounded-full" :style="{ width: `${25 + ((i * 13 + c.key.length * 7) % 35)}%` }" />
            </div>
          </li>
        </ul>
        <ul v-else-if="rows.length" class="grid gap-3 p-3 @lg:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4" :aria-label="caption">
          <li v-for="row in rows" :key="rowKey(row)">
            <article
              :class="[
                'group/card card flex h-full flex-col p-4 text-sm transition',
                clickable ? 'card-interactive cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none' : 'hover:shadow-lift',
                selectable && selected.includes(rowKey(row)) && 'ring-2 ring-brand-500/40',
                loading && 'opacity-60',
              ]"
              :tabindex="clickable ? 0 : undefined"
              @click="clickable && emit('rowClick', row)"
              @keydown.enter="clickable && emit('rowClick', row)"
            >
              <slot v-if="$slots.card" name="card" :row="row" />
              <div v-else class="flex items-start gap-3">
                <input
                  v-if="selectable && canSelect(row)"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                  :checked="selected.includes(rowKey(row))"
                  :aria-label="selectLabel ? selectLabel(row) : `Select row ${rows.indexOf(row) + 1}`"
                  @click.stop
                  @change="toggleRow(row)"
                />
                <div v-if="titleColumn" class="min-w-0 flex-1 font-medium text-fg">
                  <slot :name="`cell-${titleColumn.key}`" :row="row">{{ titleColumn.value ? titleColumn.value(row) : row[titleColumn.key] }}</slot>
                </div>
              </div>
              <dl v-if="!$slots.card && detailColumns.length" class="mt-3 space-y-2 border-t border-line/60 pt-3">
                <div v-for="col in detailColumns" :key="col.key" class="flex items-start justify-between gap-4">
                  <dt class="shrink-0 pt-0.5 text-xs font-medium text-fg-muted">{{ col.label }}</dt>
                  <dd class="min-w-0 text-end text-fg">
                    <slot :name="`cell-${col.key}`" :row="row">{{ col.value ? col.value(row) : row[col.key] }}</slot>
                  </dd>
                </div>
              </dl>
              <div v-if="!$slots.card && actionColumns.length" class="mt-auto flex flex-wrap justify-end gap-1 pt-3" @click.stop>
                <template v-for="col in actionColumns" :key="col.key">
                  <slot :name="`cell-${col.key}`" :row="row">{{ col.value ? col.value(row) : row[col.key] }}</slot>
                </template>
              </div>
            </article>
          </li>
        </ul>
      </div>
      <div v-else class="overflow-x-auto">
        <!-- Explicit roles keep table semantics when the small-screen card layout changes CSS display. -->
        <table role="table" class="min-w-full text-sm max-md:block" :aria-busy="loading || undefined">
          <caption v-if="caption" class="sr-only">{{ caption }}</caption>
          <thead role="rowgroup" class="border-b border-line bg-surface-muted/70 max-md:sr-only">
            <tr role="row">
              <th v-if="selectable" role="columnheader" scope="col" class="h-10 w-10 ps-4 pe-0">
                <input
                  type="checkbox"
                  class="h-4 w-4 cursor-pointer accent-brand-600 align-middle"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  :disabled="!selectableRows.length"
                  aria-label="Select all on this page"
                  @change="toggleAll"
                />
              </th>
              <th
                v-for="col in columns"
                :key="col.key"
                role="columnheader"
                scope="col"
                :aria-sort="ariaSort(col)"
                :class="['h-10 px-4 py-2 text-xs font-semibold whitespace-nowrap text-fg-muted', align(col), col.class]"
              >
                <button
                  v-if="col.sortField"
                  type="button"
                  :class="['group/sort -mx-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-surface-muted hover:text-fg', sortState(col) && 'text-fg']"
                  @click="toggleSort(col)"
                >
                  {{ col.label }}
                  <ArrowUp v-if="sortState(col) === 'asc'" :size="12" class="text-accent-fg" />
                  <ArrowDown v-else-if="sortState(col) === 'desc'" :size="12" class="text-accent-fg" />
                  <ArrowUpDown v-else :size="12" class="opacity-0 transition group-hover/sort:opacity-60" />
                </button>
                <template v-else>{{ col.label }}</template>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" class="divide-y divide-line/70 max-md:block">
            <template v-if="loading && rows.length === 0">
              <tr v-for="i in 5" :key="`s${i}`" role="row" class="max-md:block max-md:space-y-2 max-md:px-4 max-md:py-3">
                <td v-if="selectable" role="cell" class="w-10 ps-4 pe-0 max-md:hidden" />
                <td v-for="col in columns" :key="col.key" role="cell" class="h-11 px-4 py-2 max-md:block max-md:h-auto max-md:p-0">
                  <div class="skeleton h-3.5 rounded-full" :style="{ width: `${50 + ((i * 17 + col.key.length * 7) % 45)}%` }" />
                </td>
              </tr>
            </template>
            <tr
              v-for="row in rows"
              v-else
              :key="rowKey(row)"
              role="row"
              :class="[
                'transition-colors max-md:block max-md:px-4 max-md:py-3',
                clickable ? 'cursor-pointer hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60' : 'hover:bg-surface-muted/40',
                loading && 'opacity-60',
              ]"
              :tabindex="clickable ? 0 : undefined"
              @click="clickable && emit('rowClick', row)"
              @keydown.enter="clickable && emit('rowClick', row)"
            >
              <td v-if="selectable" role="cell" class="w-10 ps-4 pe-0 align-middle max-md:float-end max-md:p-0" @click.stop>
                <input
                  v-if="canSelect(row)"
                  type="checkbox"
                  class="h-4 w-4 cursor-pointer accent-brand-600 align-middle"
                  :checked="selected.includes(rowKey(row))"
                  :aria-label="selectLabel ? selectLabel(row) : `Select row ${rows.indexOf(row) + 1}`"
                  @change="toggleRow(row)"
                />
              </td>
              <td v-for="(col, i) in columns" :key="col.key" role="cell" :data-label="col.label" :class="cellClass(col, i)">
                <slot :name="`cell-${col.key}`" :row="row">{{ col.value ? col.value(row) : row[col.key] }}</slot>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppEmptyState v-if="!loading && rows.length === 0 && filtered" :icon="SearchX" title="No matches" description="Nothing matches your search or filters.">
        <AppButton variant="secondary" size="sm" :icon="FilterX" @click="emit('clear')">Clear filters</AppButton>
      </AppEmptyState>
      <AppEmptyState v-else-if="!loading && rows.length === 0" :title="emptyTitle" :description="emptyDescription"><slot name="empty" /></AppEmptyState>
      <AppPagination v-if="meta && meta.total > 0" class="border-t border-line" :meta="meta" :disabled="loading" @change="emit('page', $event)" />
    </template>
  </div>
</template>
