<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LedgerEntry } from '@/modules/leave/types';
import { LEDGER_LABELS } from '@/modules/leave/utils/leave-format';
import { AppEmptyState, AppErrorState, AppModal, AppSelect, AppSkeleton } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** Every credit and debit behind a balance: accruals, carry-forward, leave taken, adjustments. */
const props = defineProps<{ open: boolean; employeeId?: string; employeeName?: string; year: number; types: { id: string; code: string; name: string }[] }>();
const emit = defineEmits<{ close: [] }>();

const entries = ref<LedgerEntry[] | null>(null);
const error = ref<unknown>(null);
const loading = ref(false);
const typeId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    entries.value = await leaveApi.ledger({ employeeId: props.employeeId, year: props.year, leaveTypeId: typeId.value ?? undefined });
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
watch(
  () => [props.open, props.employeeId, props.year],
  ([open]) => {
    if (open) void load();
  },
  { immediate: true },
);
watch(typeId, () => void load());

const typeOptions = computed(() => props.types.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })));
const rows = computed(() => {
  const running = new Map<string, number>();
  return (entries.value ?? []).map((e) => {
    const total = Math.round(((running.get(e.leaveType.id) ?? 0) + e.days) * 100) / 100;
    running.set(e.leaveType.id, total);
    return { ...e, running: total };
  });
});
</script>

<template>
  <AppModal :open="open" :title="`Balance history · ${year}`" :description="employeeName" size="xl" @close="emit('close')">
    <div class="mb-3 flex justify-end">
      <AppSelect v-model="typeId" class="w-64" :options="typeOptions" placeholder="All leave types" aria-label="Filter by leave type" />
    </div>
    <AppSkeleton v-if="loading && !entries" :lines="6" />
    <AppErrorState v-else-if="error" :error="error" @retry="load" />
    <AppEmptyState v-else-if="!rows.length" compact title="No entries this year" />
    <div v-else class="max-h-[60vh] overflow-auto rounded-xl ring-1 ring-line">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-surface-muted text-left text-xs text-fg-muted">
          <tr>
            <th class="px-3 py-2 font-medium">Date</th>
            <th class="px-3 py-2 font-medium">Type</th>
            <th class="px-3 py-2 font-medium">Entry</th>
            <th class="px-3 py-2 text-right font-medium">Days</th>
            <th class="px-3 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="e in rows" :key="e.id">
            <td class="px-3 py-2 whitespace-nowrap text-fg-muted">{{ formatDate(e.effectiveDate) }}</td>
            <td class="px-3 py-2"><span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" :style="{ backgroundColor: e.leaveType.color }" aria-hidden="true" />{{ e.leaveType.code }}</span></td>
            <td class="px-3 py-2">
              <p class="text-fg">{{ LEDGER_LABELS[e.kind] }}</p>
              <p v-if="e.note" class="text-xs text-fg-muted">{{ e.note }}</p>
              <p v-if="e.createdBy" class="text-xs text-fg-subtle">{{ e.createdBy }}</p>
            </td>
            <td class="px-3 py-2 text-right font-medium tabular-nums" :class="e.days < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">{{ e.days > 0 ? '+' : '' }}{{ e.days }}</td>
            <td class="px-3 py-2 text-right text-fg-muted tabular-nums">{{ e.running }}</td>
          </tr>
        </tbody>
      </table>
      <p class="px-3 py-2 text-xs text-fg-subtle">The balance column is the running total for that leave type.</p>
    </div>
  </AppModal>
</template>
