<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import type { PaginationMeta } from '@contracts';

/** A results count; with more than one page also the range and previous / next. */
const props = defineProps<{ meta: PaginationMeta; disabled?: boolean }>();
const emit = defineEmits<{ change: [page: number] }>();

const from = computed(() => (props.meta.total === 0 ? 0 : (props.meta.page - 1) * props.meta.pageSize + 1));
const to = computed(() => Math.min(props.meta.page * props.meta.pageSize, props.meta.total));
const paged = computed(() => props.meta.totalPages > 1);
const btn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted ring-1 ring-line ring-inset transition hover:bg-surface-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35';
</script>

<template>
  <nav class="flex min-h-10 flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs text-fg-muted" aria-label="Pagination">
    <p class="tabular-nums" aria-live="polite" aria-atomic="true">
      <template v-if="paged"><span class="font-medium text-fg">{{ from }}–{{ to }}</span> of {{ meta.total.toLocaleString(appLocale()) }}</template>
      <template v-else>{{ meta.total.toLocaleString(appLocale()) }} {{ meta.total === 1 ? 'result' : 'results' }}</template>
    </p>
    <div v-if="paged" class="flex items-center gap-1.5">
      <span class="me-1 tabular-nums">Page {{ meta.page }} of {{ meta.totalPages }}</span>
      <button type="button" :class="btn" :disabled="disabled || meta.page <= 1" aria-label="Previous page" @click="emit('change', meta.page - 1)">
        <ChevronLeft :size="15" aria-hidden="true" />
      </button>
      <button type="button" :class="btn" :disabled="disabled || meta.page >= meta.totalPages" aria-label="Next page" @click="emit('change', meta.page + 1)">
        <ChevronRight :size="15" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
