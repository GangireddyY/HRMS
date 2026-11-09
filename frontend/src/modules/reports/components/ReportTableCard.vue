<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, Table2 } from '@lucide/vue';
import type { ReportTable } from '@contracts';
import { formatValue } from '@/modules/reports/utils/report-definitions';
import { AppButton, AppCard, AppEmptyState } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** One table of a report; percentage columns also show a bar. Long tables show their first rows until expanded. */
const props = withDefaults(defineProps<{ table: ReportTable; limit?: number }>(), { limit: 10 });
const cell = (v: string | number | null, format?: string) => (format === 'date' && typeof v === 'string' ? formatDate(v) : formatValue(v, format as never));
const numeric = (format?: string) => !!format && format !== 'date';
const expanded = ref(false);
const rows = computed(() => (expanded.value ? props.table.rows : props.table.rows.slice(0, props.limit)));
const hidden = computed(() => props.table.rows.length - props.limit);
</script>

<template>
  <AppCard :title="table.title" :icon="Table2" :padded="false">
    <template v-if="table.rows.length" #actions>
      <span class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted tabular-nums ring-1 ring-line ring-inset">{{ table.rows.length }} row{{ table.rows.length === 1 ? '' : 's' }}</span>
    </template>
    <AppEmptyState v-if="!table.rows.length" compact :icon="Table2" title="Nothing in this period" description="Widen the period or clear the department filter." />
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">{{ table.title }}</caption>
        <thead>
          <tr class="border-b border-line bg-surface-muted/60">
            <th
              v-for="c in table.columns"
              :key="c.key"
              scope="col"
              class="px-4 py-2 text-2xs font-semibold tracking-wider whitespace-nowrap text-fg-muted uppercase"
              :class="numeric(c.format) ? 'text-end' : 'text-start'"
            >
              {{ c.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line/60">
          <tr v-for="(r, i) in rows" :key="i" class="transition-colors hover:bg-surface-muted/50">
            <td
              v-for="(c, ci) in table.columns"
              :key="c.key"
              class="px-4 py-2 whitespace-nowrap"
              :class="numeric(c.format) ? 'text-end text-fg tabular-nums' : ci === 0 ? 'font-medium text-fg' : 'text-fg-muted'"
            >
              <span v-if="c.format === 'percent' && typeof r[c.key] === 'number'" class="inline-flex items-center justify-end gap-2.5">
                <span class="hidden h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden="true">
                  <span class="block h-full rounded-full bg-brand-500" :style="{ width: `${Math.max(2, Math.min(100, Number(r[c.key])))}%` }" />
                </span>
                <span class="w-12">{{ cell(r[c.key] ?? null, c.format) }}</span>
              </span>
              <template v-else>{{ cell(r[c.key] ?? null, c.format) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="hidden > 0" class="border-t border-line/70 px-2 py-1.5">
      <AppButton size="sm" variant="ghost" :icon-right="expanded ? ChevronUp : ChevronDown" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? 'Show fewer rows' : `Show all ${table.rows.length} rows` }}
      </AppButton>
    </div>
  </AppCard>
</template>
