<script setup lang="ts">
import type { ReportTable } from '@contracts';
import { formatValue } from '@/modules/reports/utils/report-definitions';
import { AppCard } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** One table of a report; percentage columns also show a bar. */
defineProps<{ table: ReportTable }>();
const cell = (v: string | number | null, format?: string) => (format === 'date' && typeof v === 'string' ? formatDate(v) : formatValue(v, format as never));
</script>

<template>
  <AppCard :title="table.title" :padded="false">
    <p v-if="!table.rows.length" class="px-4 py-4 text-sm text-fg-muted">Nothing in this period.</p>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">{{ table.title }}</caption>
        <thead>
          <tr class="border-b border-line text-xs text-fg-muted">
            <th v-for="c in table.columns" :key="c.key" scope="col" class="px-4 py-2 font-medium whitespace-nowrap" :class="c.format && c.format !== 'date' ? 'text-right' : 'text-left'">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="(r, i) in table.rows" :key="i">
            <td v-for="c in table.columns" :key="c.key" class="px-4 py-2 whitespace-nowrap" :class="c.format && c.format !== 'date' ? 'text-right tabular-nums' : 'text-fg'">
              <span v-if="c.format === 'percent' && typeof r[c.key] === 'number'" class="inline-flex items-center justify-end gap-2">
                <span class="hidden h-1.5 w-16 rounded-full bg-surface-muted sm:block" aria-hidden="true"><span class="block h-1.5 rounded-full bg-brand-500" :style="{ width: `${Math.min(100, Number(r[c.key]))}%` }" /></span>
                {{ cell(r[c.key] ?? null, c.format) }}
              </span>
              <template v-else>{{ cell(r[c.key] ?? null, c.format) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </AppCard>
</template>
