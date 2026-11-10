<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, Ban, Check, ClipboardList, Inbox, Ticket } from '@lucide/vue';
import { TRAVEL_STATUSES, type TravelStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { travelApi } from '@/modules/services/api/services.api';
import type { Trip } from '@/modules/services/types';
import { nights, TRAVEL_MODE_ICONS, TRAVEL_MODE_LABELS, TRAVEL_STATUS_LABELS, travelStatusTone, tripDates } from '@/modules/services/utils/services-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSearchInput, AppSelect, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Travel requests: those waiting for your approval (managers) and every trip for the travel desk (bookings, advances). */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = auth.can('travel.approve');
const isDesk = auth.can('travel.manage');
const initial = route.query.view === 'all' && isDesk ? 'all' : canApprove ? 'team' : 'all';
const table = useTable((q) => travelApi.list(q), { filters: { view: initial as 'team' | 'all', status: (initial === 'team' ? 'PENDING' : undefined) as TravelStatus | undefined } });
const view = computed({
  get: () => table.filters.view,
  set: (v: string) => {
    table.filters.view = v as 'team' | 'all';
    table.filters.status = v === 'team' ? 'PENDING' : 'APPROVED';
  },
});
const tabs = computed(() => [...(canApprove ? [{ key: 'team', label: 'To approve', icon: Inbox }] : []), ...(isDesk ? [{ key: 'all', label: 'Travel desk', icon: ClipboardList }] : [])]);
const statusOptions = TRAVEL_STATUSES.map((s) => ({ value: s, label: TRAVEL_STATUS_LABELS[s] }));
const columns: TableColumn<Trip>[] = [
  { key: 'employee', label: 'Traveller' },
  { key: 'trip', label: 'Trip' },
  { key: 'dates', label: 'Dates' },
  { key: 'cost', label: 'Cost', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const stay = (t: Trip) => nights(t.departureDate, t.returnDate);

// ---- Decide ------------------------------------------------------------------------------------
const deciding = ref<{ trip: Trip; mode: 'approve' | 'reject' } | null>(null);
const decision = reactive({ note: '', error: '' });
function openDecision(trip: Trip, mode: 'approve' | 'reject') {
  Object.assign(decision, { note: '', error: '' });
  deciding.value = { trip, mode };
}
const saving = ref(false);
async function decide() {
  const { trip, mode } = deciding.value!;
  saving.value = true;
  decision.error = '';
  try {
    await (mode === 'approve' ? travelApi.approve(trip.id, decision.note || null) : travelApi.reject(trip.id, decision.note));
    feedback.success(mode === 'approve' ? 'Trip approved' : 'Trip declined', `${trip.reference} · ${trip.employee?.name}`);
    deciding.value = null;
    await table.load();
  } catch (e) {
    decision.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}

// ---- Travel desk -------------------------------------------------------------------------------
const booking = ref<Trip | null>(null);
const desk = reactive({ bookingNotes: '', advanceReference: '', error: '' });
function openDesk(t: Trip) {
  Object.assign(desk, { bookingNotes: t.bookingNotes ?? '', advanceReference: '', error: '' });
  booking.value = t;
}
async function saveDesk() {
  const t = booking.value!;
  saving.value = true;
  desk.error = '';
  try {
    await travelApi.desk(t.id, { bookingNotes: desk.bookingNotes || null, advanceReference: desk.advanceReference || null });
    feedback.success('Saved', `${t.employee?.name} has been told.`);
    booking.value = null;
    await table.load();
  } catch (e) {
    desk.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Travel" description="Approve business trips for your team; the travel desk books approved trips and pays advances." />

    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-3 py-3 sm:grid-cols-[1fr_200px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search reference, city, purpose or person" aria-label="Search trips" />
          <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="Any status" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="Travel requests"
          :empty-title="view === 'team' ? 'Nothing to approve' : 'No trips'"
          :empty-description="view === 'team' ? 'Travel requests from your team appear here.' : 'Approved trips appear here for booking.'"
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @clear="table.clearFilters()"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.onBehalfOf ? `For ${row.onBehalfOf}` : (row.employee?.department ?? row.employee?.employeeCode) }}</p>
              </div>
            </div>
          </template>
          <template #cell-trip="{ row }">
            <p class="flex items-center gap-1.5 font-medium text-fg">
              <component :is="TRAVEL_MODE_ICONS[row.mode]" :size="14" class="shrink-0 text-fg-subtle" :aria-label="TRAVEL_MODE_LABELS[row.mode]" />{{ row.fromCity }}
              <ArrowRight :size="12" class="shrink-0 text-fg-subtle rtl:rotate-180" aria-label="to" />{{ row.toCity }}
            </p>
            <p class="max-w-72 truncate text-xs text-fg-muted"><span class="font-mono">{{ row.reference }}</span> · {{ row.purpose }}</p>
          </template>
          <template #cell-dates="{ row }">
            <p class="text-sm text-fg">{{ tripDates(row) }}</p>
            <p class="text-2xs text-fg-muted">{{ stay(row) === 0 ? 'Day trip' : `${stay(row)} night${stay(row) === 1 ? '' : 's'}` }}{{ row.needsAccommodation ? ' · hotel needed' : '' }}</p>
          </template>
          <template #cell-cost="{ row }">
            <p class="font-semibold tabular-nums">{{ rupees(row.estimatedCost) }}</p>
            <p class="text-2xs text-fg-muted tabular-nums">{{ row.advanceAmount ? `${rupees(row.advanceAmount)} advance${row.advancePaidAt ? ' · paid' : ''}` : 'No advance' }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="travelStatusTone[row.status]" size="sm" dot>{{ TRAVEL_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.status === 'APPROVED' && view === 'all'" class="mt-0.5 text-2xs text-fg-muted">{{ row.bookingNotes ? 'Booked' : 'To book' }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <template v-if="row.permissions.approve">
                <AppButton size="sm" variant="ghost" :icon="Ban" @click="openDecision(row, 'reject')">Decline</AppButton>
                <AppButton size="sm" :icon="Check" @click="openDecision(row, 'approve')">Approve</AppButton>
              </template>
              <AppButton v-else-if="row.permissions.desk && view === 'all'" size="sm" variant="secondary" :icon="Ticket" @click="openDesk(row)">Bookings</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="!!deciding" dialog :title="deciding?.mode === 'approve' ? 'Approve the trip' : 'Decline the trip'" :description="deciding ? `${deciding.trip.employee?.name}: ${deciding.trip.fromCity} → ${deciding.trip.toCity}, ${formatDate(deciding.trip.departureDate)}` : undefined" @close="deciding = null">
      <form id="travel-decision" class="space-y-4" novalidate @submit.prevent="decide">
        <AppAlert v-if="decision.error">{{ decision.error }}</AppAlert>
        <p v-if="deciding" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">{{ deciding.trip.purpose }}</p>
        <AppTextarea v-model="decision.note" :label="deciding?.mode === 'approve' ? 'Note (optional)' : 'Why not?'" :required="deciding?.mode === 'reject'" :rows="2" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="deciding = null">Cancel</AppButton>
        <AppButton type="submit" form="travel-decision" :variant="deciding?.mode === 'reject' ? 'danger' : 'primary'" :loading="saving" :disabled="deciding?.mode === 'reject' && decision.note.trim().length < 3">{{
          deciding?.mode === 'approve' ? 'Approve' : 'Decline'
        }}</AppButton>
      </template>
    </AppModal>

    <AppModal :open="!!booking" dialog title="Bookings and advance" :description="booking ? `${booking.reference} · ${booking.employee?.name} · ${booking.fromCity} → ${booking.toCity}` : undefined" @close="booking = null">
      <form id="travel-desk" class="space-y-4" novalidate @submit.prevent="saveDesk">
        <AppAlert v-if="desk.error">{{ desk.error }}</AppAlert>
        <AppTextarea v-model="desk.bookingNotes" label="Booking details for the traveller" placeholder="Flight numbers, PNR, hotel name and address…" :rows="4" :maxlength="2000" />
        <template v-if="booking?.advanceAmount">
          <p v-if="booking.advancePaidAt" class="text-sm text-success-fg">Advance of {{ rupees(booking.advanceAmount) }} paid {{ formatDate(booking.advancePaidAt) }} ({{ booking.advanceReference }}).</p>
          <AppInput v-else v-model="desk.advanceReference" :label="`Payment reference for the ${rupees(booking.advanceAmount)} advance`" placeholder="UTR or transaction id — leave empty if not paid yet" />
        </template>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="booking = null">Cancel</AppButton>
        <AppButton type="submit" form="travel-desk" :loading="saving">Save and notify</AppButton>
      </template>
    </AppModal>
  </div>
</template>
