<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarCheck, CalendarPlus, CalendarRange, ClipboardList, History, Hourglass, Info, Plane, Undo2, XCircle } from '@lucide/vue';
import type { LeaveRequestStatus } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { leaveApi } from '@/modules/leave/api/leave.api';
import ApplyLeaveModal from '@/modules/leave/components/ApplyLeaveModal.vue';
import LeaveBalanceCards from '@/modules/leave/components/LeaveBalanceCards.vue';
import LeaveLedgerModal from '@/modules/leave/components/LeaveLedgerModal.vue';
import MyLeaveGridCard from '@/modules/leave/components/MyLeaveGridCard.vue';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, formatLeaveRange, leaveStatusTone, todayIso } from '@/modules/leave/utils/leave-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Self-service leave: what you can take, what's coming up, your requests and the rules that apply. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const today = todayIso();
const balances = useAsync(() => leaveApi.balances());
const types = useAsync(() => leaveApi.types());
const table = useTable((q) => leaveApi.requests({ ...q, view: 'mine' }), { filters: { status: undefined as LeaveRequestStatus | undefined } });
/** Requests that end today or later, for the "next time off" summary regardless of the table's filter and page. */
const ahead = useAsync(() => leaveApi.requests({ view: 'mine', from: today, pageSize: 50 }));
const canApply = computed(() => auth.can('leave.apply'));
const refresh = () => Promise.all([balances.run(), table.load(), ahead.run()]);

const applyOpen = ref(false);
const applyType = ref<string | null>(null);
function openApply(typeId: string | null = null) {
  applyType.value = typeId;
  applyOpen.value = true;
}
async function onApplied() {
  applyOpen.value = false;
  feedback.success('Leave requested', 'Your manager has been notified.');
  await refresh();
}
onMounted(() => {
  if (route.query.apply !== undefined) {
    openApply();
    void router.replace({ query: {} });
  }
});

const ledgerOpen = ref(false);

const cancellable = (r: LeaveRequest) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today);
async function cancel(r: LeaveRequest) {
  const approved = r.status === 'APPROVED';
  if (!(await feedback.confirm({ title: 'Cancel this leave?', message: approved ? 'The days go back to your balance and your manager is notified.' : 'The request is withdrawn.', confirmLabel: 'Cancel leave', danger: true }))) return;
  try {
    await leaveApi.cancel(r.id);
    feedback.success('Leave cancelled');
    await refresh();
  } catch (e) {
    feedback.error('Could not cancel the leave', e);
  }
}

// ---- Dates -----------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
const midnight = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const daysUntil = (iso: string) => Math.round((midnight(iso) - midnight(today)) / DAY);
const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}
const onLeaveNow = (r: LeaveRequest) => r.status === 'APPROVED' && r.startDate <= today && r.endDate >= today;
const tile = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return { weekday: d.toLocaleDateString(appLocale(), { weekday: 'short' }), day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};

// ---- Summary ---------------------------------------------------------------------------------------------------
const round = (n: number) => Math.round(n * 100) / 100;
const list = computed(() => balances.data.value?.balances ?? []);
const limited = computed(() => list.value.filter((b) => b.available !== null && b.leaveType.isPaid));
const available = computed(() => round(limited.value.reduce((s, b) => s + (b.available ?? 0), 0)));
const upcoming = computed(() =>
  (ahead.data.value?.items ?? []).filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').sort((a, b) => a.startDate.localeCompare(b.startDate)),
);
const nextLeave = computed(() => upcoming.value[0] ?? null);
const yearProgress = computed(() => {
  const d = balances.data.value;
  if (!d || d.year !== d.currentYear) return null;
  const span = midnight(d.range.to) - midnight(d.range.from) + DAY;
  const pct = Math.round(Math.max(0, Math.min(1, (midnight(today) - midnight(d.range.from)) / span)) * 100);
  return { pct, daysLeft: Math.max(0, daysUntil(d.range.to)) };
});
const stats = computed(() => {
  const taken = round(list.value.reduce((s, b) => s + b.taken, 0));
  const pending = round(list.value.reduce((s, b) => s + b.pending, 0));
  const pendingCount = upcoming.value.filter((r) => r.status === 'PENDING').length;
  const booked = round(upcoming.value.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.days, 0));
  const carried = round(list.value.reduce((s, b) => s + b.opening, 0));
  return [
    { key: 'taken', label: 'Taken or booked', value: taken, hint: 'Approved leave this leave year', icon: CalendarCheck, tone: 'text-accent-fg bg-accent-soft' },
    {
      key: 'pending',
      label: 'Awaiting approval',
      value: pending,
      hint: pendingCount ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} with your manager` : 'Nothing waiting',
      icon: Hourglass,
      tone: pending ? 'text-warning-fg bg-warning-soft' : 'text-fg-muted bg-surface-muted',
    },
    { key: 'booked', label: 'Booked ahead', value: booked, hint: 'Approved and still to come', icon: Plane, tone: booked ? 'text-info-fg bg-info-soft' : 'text-fg-muted bg-surface-muted' },
    { key: 'carried', label: 'Carried forward', value: carried, hint: 'From last leave year', icon: Undo2, tone: carried ? 'text-success-fg bg-success-soft' : 'text-fg-muted bg-surface-muted' },
  ];
});

/** The rules people most often trip over, for the leave types this employee has. */
const policies = computed(() => {
  const ids = new Set(list.value.map((b) => b.leaveType.id));
  return (types.data.value ?? [])
    .filter((t) => ids.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      rules: [
        t.minNoticeDays ? `Apply ${t.minNoticeDays} day${t.minNoticeDays === 1 ? '' : 's'} ahead` : 'No notice needed',
        t.maxConsecutiveDays ? `up to ${t.maxConsecutiveDays} days in a row` : null,
        t.allowHalfDay ? 'half days allowed' : null,
        t.countNonWorkingDays ? 'weekends and holidays count' : null,
        t.carryForwardLimit ? `${t.carryForwardLimit} days carry forward` : null,
        t.encashable ? 'encashable' : null,
      ].filter(Boolean) as string[],
    }));
});

// ---- Requests table --------------------------------------------------------------------------------------------
const columns: TableColumn<LeaveRequest>[] = [
  { key: 'type', label: 'Leave' },
  { key: 'dates', label: 'Dates' },
  { key: 'days', label: 'Days', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
type StatusFilter = LeaveRequestStatus | 'ALL';
const statusFilter = computed<StatusFilter>({
  get: () => table.filters.status ?? 'ALL',
  set: (v) => (table.filters.status = v === 'ALL' ? undefined : v),
});
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  ...(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] })),
];
const tint = (color: string | undefined, amount: number) => (color ? `color-mix(in srgb, ${color} ${amount}%, transparent)` : undefined);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Leave" description="What you can take, what's coming up, and every request you've made.">
      <template #actions>
        <AppButton variant="secondary" :icon="History" :disabled="!balances.data.value" @click="ledgerOpen = true">Balance history</AppButton>
        <AppButton v-if="canApply" :icon="CalendarPlus" :disabled="!balances.data.value?.balances.length" @click="openApply()">Apply for leave</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="balances.loading.value && !balances.data.value" :lines="4" />
    <AppErrorState v-else-if="balances.error.value" :error="balances.error.value" title="Could not load your balances" @retry="balances.run" />
    <AppCard v-else-if="!balances.data.value?.balances.length">
      <AppEmptyState :icon="Plane" title="No leave types yet" description="Your HR team hasn't set up leave types for the organization." />
    </AppCard>
    <template v-else>
      <!-- Summary -->
      <section class="card overflow-hidden" aria-label="Leave summary">
        <div class="relative flex flex-wrap items-center gap-6 bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 px-6 py-6 text-white">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_-10%,rgba(255,255,255,0.28),transparent_45%),radial-gradient(circle_at_0%_120%,rgba(255,255,255,0.18),transparent_45%)]" aria-hidden="true" />
          <div class="relative min-w-0 flex-1 basis-72">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <CalendarRange :size="13" aria-hidden="true" />Leave year {{ formatDate(balances.data.value.range.from) }} – {{ formatDate(balances.data.value.range.to) }}
            </p>
            <template v-if="limited.length">
              <p class="mt-4 text-sm text-white/80">Available to take</p>
              <p class="flex items-baseline gap-2">
                <span class="text-5xl leading-none font-semibold tracking-tight tabular-nums">{{ available }}</span>
                <span class="text-lg text-white/85">{{ available === 1 ? 'day' : 'days' }}</span>
              </p>
              <p class="mt-2 text-sm text-white/85">Across {{ limited.length }} paid leave type{{ limited.length === 1 ? '' : 's' }}{{ list.length > limited.length ? ', plus leave without a limit' : '' }}.</p>
            </template>
            <template v-else>
              <h2 class="mt-4 text-2xl font-semibold tracking-tight">No limit on your leave</h2>
              <p class="mt-1 text-sm text-white/85">Your leave types don't have a fixed balance. Agree time off with your manager.</p>
            </template>
            <div v-if="yearProgress" class="mt-5 max-w-md">
              <div class="mb-1.5 flex justify-between text-2xs text-white/80">
                <span>Leave year {{ yearProgress.pct }}% through</span>
                <span class="tabular-nums">{{ yearProgress.daysLeft }} days left</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" :aria-valuenow="yearProgress.pct" aria-valuemin="0" aria-valuemax="100" aria-label="Leave year elapsed">
                <div class="h-full rounded-full bg-white transition-[width] duration-700" :style="{ width: `${yearProgress.pct}%` }" />
              </div>
            </div>
          </div>

          <div class="relative w-full rounded-xl bg-white/12 p-4 ring-1 ring-white/25 backdrop-blur sm:w-80" aria-live="polite">
            <p class="text-2xs font-semibold tracking-wide text-white/80 uppercase">{{ nextLeave && onLeaveNow(nextLeave) ? 'On leave now' : 'Next time off' }}</p>
            <div v-if="nextLeave" class="mt-3 flex items-center gap-3">
              <div class="flex w-16 shrink-0 flex-col items-center rounded-xl bg-white py-1.5 text-slate-900 shadow-sm">
                <span class="text-2xs font-semibold tracking-wide text-brand-700 uppercase">{{ tile(nextLeave.startDate).weekday }}</span>
                <span class="text-2xl leading-7 font-semibold tabular-nums">{{ tile(nextLeave.startDate).day }}</span>
                <span class="text-2xs text-slate-500">{{ tile(nextLeave.startDate).month }}</span>
              </div>
              <div class="min-w-0">
                <p class="truncate font-semibold">{{ nextLeave.leaveType?.name }}</p>
                <p class="text-xs text-white/85">{{ formatLeaveRange(nextLeave) }} · {{ formatDays(nextLeave.days) }}</p>
                <p class="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-2xs font-medium">
                  <span :class="['h-1.5 w-1.5 rounded-full', nextLeave.status === 'APPROVED' ? 'bg-emerald-300' : 'bg-amber-300']" aria-hidden="true" />
                  {{ LEAVE_STATUS_LABELS[nextLeave.status] }}<template v-if="!onLeaveNow(nextLeave)"> · starts {{ relativeDay(nextLeave.startDate) }}</template>
                </p>
              </div>
            </div>
            <p v-if="upcoming.length > 1" class="mt-3 border-t border-white/20 pt-2 text-xs text-white/80">+ {{ upcoming.length - 1 }} more coming up</p>
            <template v-if="!nextLeave">
              <p class="mt-2 text-sm font-medium">Nothing booked yet</p>
              <p class="mt-0.5 text-xs text-white/80">{{ yearProgress ? `${yearProgress.daysLeft} days left to use this year's leave. A break helps.` : 'Plan a break when you need one.' }}</p>
              <AppButton v-if="canApply" class="mt-3" size="sm" variant="secondary" :icon="CalendarPlus" @click="openApply()">Plan time off</AppButton>
            </template>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-px bg-line/70 xl:grid-cols-4">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }} <span class="text-xs font-normal text-fg-muted">{{ s.value === 1 || s.value === 0.5 ? 'day' : 'days' }}</span></p>
              <p class="truncate text-xs font-medium text-fg-muted">{{ s.label }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ s.hint }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Balances -->
      <section aria-labelledby="balances-title">
        <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="balances-title" class="text-sm font-semibold text-fg">Balances by leave type</h2>
            <p class="text-xs text-fg-muted">Credited days, what you've used and what's waiting for approval.</p>
          </div>
          <AppButton size="sm" variant="link" :icon="History" @click="ledgerOpen = true">How these add up</AppButton>
        </div>
        <LeaveBalanceCards :balances="balances.data.value.balances" :can-apply="canApply" @apply="openApply" />
      </section>
    </template>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <AppCard title="My requests" :icon="ClipboardList" :description="table.meta.value ? `${table.meta.value.total} ${table.isFiltered.value ? 'matching' : 'in total'}` : undefined" :padded="false">
        <template #actions>
          <AppSegmented v-model="statusFilter" size="sm" :options="statusOptions" label="Filter by status" />
        </template>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="My leave requests"
          empty-title="No leave requests"
          :empty-description="canApply ? 'Requests you submit appear here with their status.' : undefined"
          @page="table.setPage"
          @retry="table.load"
          :filtered="table.isFiltered.value"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton v-if="canApply" :icon="CalendarPlus" :disabled="!balances.data.value?.balances.length" @click="openApply()">Apply for leave</AppButton></template>
          <template #cell-type="{ row }">
            <span class="flex items-center gap-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :style="{ backgroundColor: tint(row.leaveType?.color, 14), color: row.leaveType?.color }" aria-hidden="true"><Plane :size="15" /></span>
              <span class="min-w-0">
                <span class="block font-medium text-fg">{{ row.leaveType?.name }}</span>
                <span class="block max-w-xs truncate text-xs text-fg-muted" :title="row.reason">{{ row.reason }}</span>
              </span>
            </span>
          </template>
          <template #cell-dates="{ row }">
            <span class="block text-fg">{{ formatLeaveRange(row) }}</span>
            <span class="block text-xs text-fg-subtle">
              <template v-if="onLeaveNow(row)"><span class="font-medium text-info-fg">On leave now</span> · </template>
              <template v-else-if="row.startDate > today && (row.status === 'APPROVED' || row.status === 'PENDING')"><span class="font-medium text-fg-muted">Starts {{ relativeDay(row.startDate) }}</span> · </template>
              Applied {{ timeAgo(row.createdAt) }}
            </span>
          </template>
          <template #cell-days="{ row }"><span class="font-medium tabular-nums">{{ formatDays(row.days) }}</span></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="leaveStatusTone[row.status]" dot>{{ LEAVE_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.status === 'REJECTED' && row.reviewNote" class="mt-0.5 max-w-xs text-xs text-danger-fg">“{{ row.reviewNote }}”</p>
            <p v-else-if="row.reviewedBy && row.status === 'APPROVED'" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
            <p v-else-if="row.status === 'CANCELLED' && row.cancelledBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.cancelledBy }}</p>
            <p v-else-if="row.status === 'PENDING'" class="mt-0.5 text-xs text-fg-subtle">with your manager</p>
          </template>
          <template #cell-actions="{ row }">
            <AppButton v-if="cancellable(row)" size="sm" variant="ghost" :icon="XCircle" :aria-label="`Cancel ${row.leaveType?.name ?? 'leave'} ${formatLeaveRange(row)}`" @click="cancel(row)">Cancel</AppButton>
          </template>
          <template #card="{ row }"><MyLeaveGridCard :request="row" :cancellable="cancellable(row)" :starts-in="relativeDay(row.startDate)" @cancel="cancel(row)" /></template>
        </AppDataTable>
      </AppCard>

      <aside class="space-y-4">
        <AppCard title="Coming up" :padded="false">
          <AppSkeleton v-if="ahead.loading.value && !ahead.data.value" class="p-4" :lines="2" />
          <AppErrorState v-else-if="ahead.error.value" :error="ahead.error.value" @retry="ahead.run" />
          <AppEmptyState v-else-if="!upcoming.length" compact :icon="Plane" title="No time off planned" description="Approved and pending leave from today onwards shows here." />
          <ul v-else class="divide-y divide-line/70">
            <li v-for="r in upcoming.slice(0, 6)" :key="r.id" class="flex items-center gap-3 px-4 py-3">
              <div class="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1">
                <span class="text-2xs font-semibold text-fg-muted uppercase">{{ tile(r.startDate).month }}</span>
                <span class="text-base leading-5 font-semibold text-fg tabular-nums">{{ tile(r.startDate).day }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                  <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: r.leaveType?.color }" aria-hidden="true" />{{ r.leaveType?.name }}
                </p>
                <p class="truncate text-xs text-fg-muted">{{ formatDays(r.days) }} · {{ onLeaveNow(r) ? 'now' : relativeDay(r.startDate) }}</p>
              </div>
              <AppBadge size="sm" :tone="leaveStatusTone[r.status]" dot>{{ LEAVE_STATUS_LABELS[r.status] }}</AppBadge>
            </li>
          </ul>
        </AppCard>

        <AppCard v-if="policies.length" title="Good to know" :icon="Info">
          <ul class="space-y-3">
            <li v-for="p in policies" :key="p.id" class="flex gap-2.5">
              <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: p.color }" aria-hidden="true" />
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ p.name }}</p>
                <p class="text-xs text-fg-muted">{{ p.rules.join(' · ') }}</p>
              </div>
            </li>
          </ul>
        </AppCard>
      </aside>
    </div>

    <ApplyLeaveModal
      v-if="balances.data.value && types.data.value"
      :open="applyOpen"
      :balances="balances.data.value.balances"
      :types="types.data.value"
      :initial-type-id="applyType"
      @close="applyOpen = false"
      @applied="onApplied"
    />
    <LeaveLedgerModal
      v-if="balances.data.value"
      :open="ledgerOpen"
      :year="balances.data.value.year"
      :types="balances.data.value.balances.map((b) => b.leaveType)"
      @close="ledgerOpen = false"
    />
  </div>
</template>
