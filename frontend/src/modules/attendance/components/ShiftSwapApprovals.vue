<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ArrowLeftRight, Check, X } from '@lucide/vue';
import type { ShiftSwapStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { ShiftSwap } from '@/modules/attendance/types';
import { SWAP_STATUS, swapShift } from '@/modules/attendance/utils/shift-swaps';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppSelect, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Shift swaps both colleagues agreed to, waiting for the manager: approving rosters each onto the other's shift. */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const table = useTable((q) => attendanceApi.swaps({ ...q, view: 'team' }), { filters: { status: 'PENDING' as ShiftSwapStatus | undefined }, url: 'swap' });
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: SWAP_STATUS[s].label }));
const columns: TableColumn<ShiftSwap>[] = [
  { key: 'people', label: 'Swap' },
  { key: 'reason', label: 'Day and reason' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

const deciding = reactive({ swap: null as ShiftSwap | null, mode: 'approve' as 'approve' | 'reject', note: '', error: '' });
const title = computed(() => (deciding.mode === 'approve' ? 'Approve the swap' : 'Decline the swap'));
function open(swap: ShiftSwap, mode: 'approve' | 'reject') {
  Object.assign(deciding, { swap, mode, note: '', error: '' });
}
const saving = ref(false);
async function decide() {
  const s = deciding.swap!;
  saving.value = true;
  deciding.error = '';
  try {
    await (deciding.mode === 'approve' ? attendanceApi.approveSwap(s.id, deciding.note || null) : attendanceApi.rejectSwap(s.id, deciding.note));
    feedback.success(deciding.mode === 'approve' ? 'Swap approved — the roster is updated' : 'Swap declined');
    deciding.swap = null;
    await table.load();
    emit('changed');
  } catch (e) {
    deciding.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard :padded="false">
    <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
      <p class="me-auto text-xs text-fg-muted">Both colleagues have agreed; approving puts each on the other's shift that day.</p>
      <AppSelect v-model="table.filters.status" size="sm" class="w-56" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
    </div>
    <AppDataTable
      :columns="columns"
      :rows="table.rows.value"
      :loading="table.loading.value"
      :error="table.error.value"
      :meta="table.meta.value"
      caption="Shift swaps"
      :empty-title="table.filters.status === 'PENDING' ? 'Nothing to review' : 'No shift swaps'"
      empty-description="When colleagues agree to trade shifts, the swap waits here for your approval."
      :filtered="table.isFiltered.value"
      @page="table.setPage"
      @retry="table.load"
      @clear="table.clearFilters()"
    >
      <template #cell-people="{ row }">
        <ul class="space-y-1">
          <li v-for="(p, i) in [row.requester, row.colleague]" :key="i" class="flex items-center gap-2">
            <AppAvatar :name="p.name" size="xs" />
            <p class="min-w-0 truncate text-sm">
              <span class="font-medium text-fg">{{ p.name }}</span>
              <span class="text-xs text-fg-muted"> · {{ swapShift(p.shift) }} <ArrowLeftRight :size="11" class="inline" aria-label="becomes" /> {{ swapShift((i ? row.requester : row.colleague).shift) }}</span>
            </p>
          </li>
        </ul>
        <p v-if="row.onBehalfOf" class="mt-1 text-2xs text-fg-muted">On behalf of {{ row.onBehalfOf }}</p>
      </template>
      <template #cell-reason="{ row }">
        <p class="text-sm font-medium whitespace-nowrap text-fg">{{ formatDate(row.workDate) }}</p>
        <p class="max-w-56 truncate text-xs text-fg">{{ row.reason }}</p>
        <p v-if="row.colleagueNote" class="max-w-64 truncate text-2xs text-fg-muted">{{ row.colleague.name }}: “{{ row.colleagueNote }}”</p>
      </template>
      <template #cell-status="{ row }">
        <AppBadge :tone="SWAP_STATUS[row.status].tone" size="sm" dot>{{ SWAP_STATUS[row.status].label }}</AppBadge>
        <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="row.permissions.review" class="flex justify-end gap-2">
          <AppButton size="sm" variant="secondary" :icon="X" @click="open(row, 'reject')">Decline</AppButton>
          <AppButton size="sm" :icon="Check" @click="open(row, 'approve')">Approve</AppButton>
        </div>
      </template>
    </AppDataTable>

    <AppModal :open="!!deciding.swap" dialog :title="title" :description="deciding.swap ? `${deciding.swap.requester.name} ⇄ ${deciding.swap.colleague.name} · ${formatDate(deciding.swap.workDate)}` : undefined" @close="deciding.swap = null">
      <form id="swap-decision" class="space-y-4" novalidate @submit.prevent="decide">
        <AppAlert v-if="deciding.error">{{ deciding.error }}</AppAlert>
        <AppTextarea v-model="deciding.note" :label="deciding.mode === 'approve' ? 'Note (optional)' : 'Why not?'" :required="deciding.mode === 'reject'" :rows="2" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="deciding.swap = null">Cancel</AppButton>
        <AppButton type="submit" form="swap-decision" :variant="deciding.mode === 'reject' ? 'danger' : 'primary'" :loading="saving" :disabled="deciding.mode === 'reject' && deciding.note.trim().length < 3">{{
          deciding.mode === 'approve' ? 'Approve' : 'Decline'
        }}</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
