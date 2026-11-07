<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import type { PaginationMeta } from '@contracts';

const props = defineProps<{ meta: PaginationMeta; disabled?: boolean }>();
const emit = defineEmits<{ change: [page: number] }>();

const from = computed(() => (props.meta.total === 0 ? 0 : (props.meta.page - 1) * props.meta.pageSize + 1));
const to = computed(() => Math.min(props.meta.page * props.meta.pageSize, props.meta.total));
const btn =
  'inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-xs font-medium text-fg transition hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40';
</script>

<template>
  <nav class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13px] text-fg-muted" aria-label="Pagination">
    <p>
      Showing <span class="font-medium text-fg tabular-nums">{{ from }}–{{ to }}</span> of
      <span class="font-medium text-fg tabular-nums">{{ meta.total }}</span>
    </p>
    <div class="flex items-center gap-2">
      <span class="hidden text-xs tabular-nums sm:inline">Page {{ meta.page }} of {{ meta.totalPages }}</span>
      <button type="button" :class="btn" :disabled="disabled || meta.page <= 1" aria-label="Previous page" @click="emit('change', meta.page - 1)">
        <ChevronLeft :size="15" aria-hidden="true" /> <span class="hidden sm:inline">Previous</span>
      </button>
      <button type="button" :class="btn" :disabled="disabled || meta.page >= meta.totalPages" aria-label="Next page" @click="emit('change', meta.page + 1)">
        <span class="hidden sm:inline">Next</span> <ChevronRight :size="15" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
