<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed } from 'vue';
import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/vue';
import type { PaginationMeta } from '@contracts';
import AppPagination from '@/shared/components/data/AppPagination.vue';
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
  }>(),
  { rowKey: (row: Row) => String(row.id), emptyTitle: 'No records found', clickable: false },
);

const emit = defineEmits<{ 'update:sort': [sort: string]; page: [page: number]; retry: []; rowClick: [row: Row] }>();

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

const align = (col: TableColumn<Row>) => (col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left');

/** Below `md` each row renders as a card: the first column is the card title, the others are label/value pairs. */
function cellClass(col: TableColumn<Row>, index: number) {
  return [
    'px-4 py-2 align-middle text-fg md:table-cell',
    align(col),
    col.class,
    index === 0
      ? 'max-md:block max-md:px-0 max-md:pt-0 max-md:pb-1 max-md:text-left'
      : 'max-md:flex max-md:min-h-7 max-md:items-center max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1 max-md:text-right ' +
        'max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-medium max-md:before:text-fg-muted max-md:before:content-[attr(data-label)]',
  ];
}

const sortable = computed(() => props.columns.filter((c) => c.sortField));
const sortOptions = computed(() =>
  sortable.value.flatMap((c) => [
    { value: `${c.sortField}:asc`, label: `${c.label} (ascending)` },
    { value: `${c.sortField}:desc`, label: `${c.label} (descending)` },
  ]),
);
</script>

<template>
  <div class="overflow-hidden">
    <AppErrorState v-if="error && !loading" :error="error" @retry="emit('retry')" />
    <template v-else>
      <div v-if="sortOptions.length && rows.length > 1" class="border-b border-line px-3 py-2 md:hidden">
        <div class="flex items-center gap-2 text-xs text-fg-muted">
          <span class="shrink-0 font-medium" aria-hidden="true">Sort by</span>
          <AppSelect
            :model-value="sortOptions.some((o) => o.value === sort) ? sort : undefined"
            :options="sortOptions"
            placeholder="Default order"
            :clearable="false"
            :searchable="false"
            aria-label="Sort by"
            size="sm"
            class="flex-1"
            @update:model-value="(v) => v && emit('update:sort', v)"
          />
        </div>
      </div>
      <div class="overflow-x-auto">
        <!-- Explicit roles keep table semantics when the small-screen card layout changes CSS display. -->
        <table role="table" class="min-w-full text-sm max-md:block">
          <caption v-if="caption" class="sr-only">{{ caption }}</caption>
          <thead role="rowgroup" class="border-b border-line bg-surface-muted/40 max-md:sr-only">
            <tr role="row">
              <th
                v-for="col in columns"
                :key="col.key"
                role="columnheader"
                scope="col"
                :aria-sort="ariaSort(col)"
                :class="['px-4 py-2 text-xs font-medium whitespace-nowrap text-fg-muted', align(col), col.class]"
              >
                <button
                  v-if="col.sortField"
                  type="button"
                  :class="['group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-muted hover:text-fg', sortState(col) && 'text-fg']"
                  @click="toggleSort(col)"
                >
                  {{ col.label }}
                  <ArrowUp v-if="sortState(col) === 'asc'" :size="12" class="text-brand-600 dark:text-brand-400" />
                  <ArrowDown v-else-if="sortState(col) === 'desc'" :size="12" class="text-brand-600 dark:text-brand-400" />
                  <ArrowUpDown v-else :size="12" class="opacity-0 transition group-hover/sort:opacity-60" />
                </button>
                <template v-else>{{ col.label }}</template>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" class="divide-y divide-line/70 max-md:block">
            <template v-if="loading && rows.length === 0">
              <tr v-for="i in 5" :key="`s${i}`" role="row" class="max-md:block max-md:space-y-2 max-md:px-3 max-md:py-3">
                <td v-for="col in columns" :key="col.key" role="cell" class="px-4 py-3 max-md:block max-md:p-0">
                  <div class="h-3.5 animate-pulse rounded-full bg-surface-muted" :style="{ width: `${50 + ((i * 17 + col.key.length * 7) % 45)}%` }" />
                </td>
              </tr>
            </template>
            <tr
              v-for="row in rows"
              v-else
              :key="rowKey(row)"
              role="row"
              :class="[
                'transition-colors max-md:block max-md:px-3 max-md:py-2.5',
                clickable && 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/50 dark:hover:bg-white/[0.03]',
                loading && 'opacity-60',
              ]"
              :tabindex="clickable ? 0 : undefined"
              @click="clickable && emit('rowClick', row)"
              @keydown.enter="clickable && emit('rowClick', row)"
            >
              <td v-for="(col, i) in columns" :key="col.key" role="cell" :data-label="col.label" :class="cellClass(col, i)">
                <slot :name="`cell-${col.key}`" :row="row">{{ col.value ? col.value(row) : row[col.key] }}</slot>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppEmptyState v-if="!loading && rows.length === 0" :title="emptyTitle" :description="emptyDescription"><slot name="empty" /></AppEmptyState>
      <AppPagination v-if="meta && meta.total > 0" class="border-t border-line" :meta="meta" :disabled="loading" @change="emit('page', $event)" />
    </template>
  </div>
</template>
