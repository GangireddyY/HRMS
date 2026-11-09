<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CalendarRange, InfinityIcon, Pencil, Plus, Sparkles, Trash2, Undo2 } from '@lucide/vue';
import { RECOMMENDED_LEAVE_TYPES } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import LeaveTypeFormModal from '@/modules/leave/components/LeaveTypeFormModal.vue';
import type { LeaveType } from '@/modules/leave/types';
import { ACCRUAL_SHORT, MONTH_NAMES, formatDays } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSelect, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Leave types as cards (credit, carry-forward and the rules for applying as chips), plus the organization's leave year. */
const feedback = useFeedbackStore();
const types = useAsync(() => leaveApi.types());
const settings = useAsync(() => leaveApi.settings());

const missingRecommended = computed(() => {
  const codes = new Set((types.data.value ?? []).map((t) => t.code));
  return RECOMMENDED_LEAVE_TYPES.filter((t) => !codes.has(t.code));
});
const adding = ref(false);
async function addRecommended() {
  adding.value = true;
  try {
    const r = await leaveApi.addRecommended();
    types.data.value = r.types;
    feedback.success(`${r.added} leave type${r.added === 1 ? '' : 's'} added`, 'Review the quotas and rules to match your policy.');
  } catch (e) {
    feedback.error('Could not add the leave types', e);
  } finally {
    adding.value = false;
  }
}

const modalOpen = ref(false);
const editing = ref<LeaveType | null>(null);
function open(t: LeaveType | null = null) {
  editing.value = t;
  modalOpen.value = true;
}
async function onSaved() {
  modalOpen.value = false;
  feedback.success(editing.value ? 'Leave type updated' : 'Leave type created');
  await types.run();
}
async function remove(t: LeaveType) {
  if (!(await feedback.confirm({ title: `Delete ${t.name}?`, message: 'Only types that were never used can be deleted. Mark used types inactive instead.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await leaveApi.removeType(t.id);
    feedback.success('Leave type deleted');
    await types.run();
  } catch (e) {
    feedback.error('Could not delete the leave type', e);
  }
}

const startMonth = ref<number | null>(null);
watch(settings.data, (s) => (startMonth.value = s?.leaveYearStartMonth ?? null), { immediate: true });
const monthOptions = MONTH_NAMES.map((m, i) => ({ value: i + 1, label: `${m} – ${MONTH_NAMES[(i + 11) % 12]}` }));
const savingYear = ref(false);
async function saveYear() {
  savingYear.value = true;
  try {
    settings.data.value = await leaveApi.updateSettings(startMonth.value!);
    feedback.success('Leave year updated');
  } catch (e) {
    startMonth.value = settings.data.value?.leaveYearStartMonth ?? null;
    feedback.error('Could not change the leave year', e);
  } finally {
    savingYear.value = false;
  }
}

// ---- Cards ------------------------------------------------------------------------------------------------------
const list = computed(() => types.data.value ?? []);
type Filter = 'all' | 'active' | 'inactive';
const filter = ref<Filter>('all');
const filterOptions = computed(() => [
  { value: 'all' as const, label: `All ${list.value.length}` },
  { value: 'active' as const, label: `Active ${list.value.filter((t) => t.isActive).length}` },
  { value: 'inactive' as const, label: `Inactive ${list.value.filter((t) => !t.isActive).length}` },
]);
const shown = computed(() => list.value.filter((t) => filter.value === 'all' || (filter.value === 'active') === t.isActive));

const strip = computed<StripItem[]>(() => {
  const active = list.value.filter((t) => t.isActive);
  const paidQuota = active.filter((t) => t.isPaid && !t.unlimited && t.accrualFrequency !== 'NONE').reduce((s, t) => s + t.annualQuota, 0);
  return [
    { key: 'active', label: 'Active types', value: active.length, tone: 'success', hint: `${list.value.length - active.length} inactive` },
    { key: 'paid', label: 'Paid days a year', value: paidQuota, tone: 'brand', hint: 'Credited per person, full year' },
    { key: 'carry', label: 'Carry forward', value: active.filter((t) => !t.unlimited && t.carryForwardLimit > 0).length, tone: 'info', hint: 'Types that roll over' },
    { key: 'unpaid', label: 'Unpaid', value: active.filter((t) => !t.isPaid).length, tone: 'warning', hint: 'Reported to payroll as loss of pay' },
  ];
});

const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, transparent)`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The rules for applying, as short chips; `warn` marks the stricter ones. */
const rules = (t: LeaveType): { label: string; warn?: boolean }[] =>
  [
    t.minNoticeDays ? { label: `${plural(t.minNoticeDays, 'day')} notice` } : { label: 'No notice needed' },
    t.maxBackdatedDays ? { label: `Back-date up to ${plural(t.maxBackdatedDays, 'day')}` } : null,
    t.maxConsecutiveDays ? { label: `Max ${plural(t.maxConsecutiveDays, 'day')} in a row`, warn: true } : null,
    t.allowHalfDay ? { label: 'Half days' } : null,
    t.countNonWorkingDays ? { label: 'Counts weekends and holidays', warn: true } : null,
    t.eligibleAfterDays ? { label: `After ${plural(t.eligibleAfterDays, 'day')} of service` } : null,
    t.applicableGender ? { label: t.applicableGender === 'FEMALE' ? 'Women only' : 'Men only' } : null,
    t.prorateOnJoining && !t.unlimited ? { label: 'Pro-rated for joiners' } : null,
    t.allowNegativeBalance ? { label: 'Can go below zero', warn: true } : null,
    t.encashable ? { label: 'Encashable' } : null,
  ].filter((r): r is { label: string; warn?: boolean } => !!r);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Leave types" description="What employees can apply for, how days are credited and the rules for applying.">
      <template #actions>
        <AppButton v-if="missingRecommended.length && types.data.value?.length" variant="secondary" :icon="Sparkles" :loading="adding" @click="addRecommended">Add recommended</AppButton>
        <AppButton :icon="Plus" @click="open()">New leave type</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip v-if="list.length" :items="strip" label="Leave types summary" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 space-y-3">
        <AppCard v-if="types.error.value"><AppErrorState :error="types.error.value" title="Could not load leave types" @retry="types.run" /></AppCard>
        <ul v-else-if="types.loading.value && !types.data.value" class="grid gap-4 md:grid-cols-2" aria-label="Loading leave types">
          <li v-for="i in 4" :key="i" class="card space-y-3 p-5">
            <div class="flex items-center gap-3"><div class="skeleton h-10 w-10 rounded-lg" /><div class="skeleton h-4 w-1/2 rounded-full" /></div>
            <div class="skeleton h-7 w-1/3 rounded-md" />
            <div class="flex gap-2"><div class="skeleton h-5 w-20 rounded-full" /><div class="skeleton h-5 w-24 rounded-full" /></div>
          </li>
        </ul>
        <AppCard v-else-if="!list.length">
          <AppEmptyState :icon="CalendarRange" title="No leave types yet" description="Start with the recommended set (casual, sick, earned and leave without pay) and adjust it, or create your own.">
            <div class="flex flex-wrap justify-center gap-2">
              <AppButton :icon="Sparkles" :loading="adding" @click="addRecommended">Add recommended types</AppButton>
              <AppButton variant="secondary" :icon="Plus" @click="open()">Create a leave type</AppButton>
            </div>
          </AppEmptyState>
        </AppCard>
        <template v-else>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-fg">{{ plural(shown.length, 'leave type') }}</h2>
            <AppSegmented v-model="filter" size="sm" :options="filterOptions" label="Show leave types" />
          </div>
          <ul class="grid gap-4 md:grid-cols-2">
            <li v-for="t in shown" :key="t.id" :class="['card relative flex flex-col overflow-hidden transition hover:shadow-lift', !t.isActive && 'opacity-75']">
              <span class="absolute inset-x-0 top-0 h-1" :style="{ backgroundColor: t.isActive ? t.color : 'var(--status-neutral)' }" aria-hidden="true" />
              <div class="flex flex-1 flex-col p-5 pt-6">
                <div class="flex items-start gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold" :style="{ backgroundColor: tint(t.color, 14), color: t.color }" aria-hidden="true">{{ t.code }}</span>
                  <div class="min-w-0 flex-1">
                    <h3 class="truncate text-base font-semibold text-fg">{{ t.name }}</h3>
                    <p class="text-xs text-fg-muted">{{ t.isPaid ? 'Paid leave' : 'Unpaid · reported as loss of pay' }}</p>
                  </div>
                  <AppBadge :tone="t.isActive ? 'success' : 'neutral'" dot>{{ t.isActive ? 'Active' : 'Inactive' }}</AppBadge>
                </div>

                <div class="mt-4 grid grid-cols-2 gap-3">
                  <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5 ring-1 ring-line/70 ring-inset">
                    <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Credit</p>
                    <p v-if="t.unlimited" class="mt-0.5 flex items-center gap-1.5 text-lg leading-7 font-semibold text-fg"><InfinityIcon :size="18" aria-hidden="true" />No limit</p>
                    <p v-else-if="t.accrualFrequency === 'NONE'" class="mt-0.5 text-lg leading-7 font-semibold text-fg">By HR</p>
                    <p v-else class="mt-0.5 text-lg leading-7 font-semibold text-fg tabular-nums">{{ t.annualQuota }} <span class="text-xs font-normal text-fg-muted">days / year</span></p>
                    <p class="text-2xs text-fg-subtle">{{ t.unlimited ? 'Taken as needed' : t.accrualFrequency === 'NONE' ? 'Granted case by case' : `Credited ${ACCRUAL_SHORT[t.accrualFrequency].toLowerCase()}` }}</p>
                  </div>
                  <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5 ring-1 ring-line/70 ring-inset">
                    <p class="flex items-center gap-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase"><Undo2 :size="11" aria-hidden="true" />Carry forward</p>
                    <p class="mt-0.5 text-lg leading-7 font-semibold text-fg tabular-nums">
                      <template v-if="t.unlimited">—</template>
                      <template v-else-if="t.carryForwardLimit">{{ t.carryForwardLimit }} <span class="text-xs font-normal text-fg-muted">days max</span></template>
                      <template v-else>Lapses</template>
                    </p>
                    <p class="text-2xs text-fg-subtle">{{ t.unlimited ? 'Nothing to carry' : t.carryForwardLimit ? 'Rest lapses at year end' : 'Unused days lapse at year end' }}</p>
                  </div>
                </div>

                <p v-if="t.description" class="mt-3 line-clamp-2 text-sm text-fg-muted" :title="t.description">{{ t.description }}</p>

                <ul class="mt-3 flex flex-wrap gap-1.5" :aria-label="`Rules for ${t.name}`">
                  <li
                    v-for="r in rules(t)"
                    :key="r.label"
                    :class="['rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset', r.warn ? 'bg-warning-soft text-warning-fg ring-warning/20' : 'bg-surface-muted text-fg-muted ring-line']"
                  >
                    {{ r.label }}
                  </li>
                </ul>
              </div>
              <footer class="flex items-center gap-1 border-t border-line/70 bg-surface-muted/40 px-3 py-2">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${t.name}`" @click="open(t)">Edit</AppButton>
                <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${t.name}`" @click="remove(t)">Delete</AppButton>
                <span v-if="!t.unlimited && t.accrualFrequency !== 'NONE'" class="ms-auto pe-1 text-2xs text-fg-subtle tabular-nums">{{ formatDays(Math.round((t.annualQuota / 12) * 100) / 100) }} a month</span>
              </footer>
            </li>
          </ul>
        </template>
      </div>

      <aside class="space-y-4">
        <AppCard title="Leave year" :icon="CalendarRange" description="Balances are credited and carried forward per leave year.">
          <AppSelect v-model="startMonth" label="Leave year runs" :options="monthOptions" :clearable="false" />
          <p class="mt-2 text-xs text-fg-muted">It can't change once balances exist.</p>
          <AppButton class="mt-3 w-full" variant="secondary" :loading="savingYear" :disabled="!settings.data.value || startMonth === settings.data.value.leaveYearStartMonth" @click="saveYear">Save leave year</AppButton>
        </AppCard>

        <AppAlert v-if="list.some((t) => !t.isPaid && !t.unlimited)" tone="info">Unpaid leave types are reported to payroll as loss of pay.</AppAlert>

        <AppCard v-if="missingRecommended.length && list.length" title="Recommended" :icon="Sparkles" description="Common types you don't have yet.">
          <ul class="space-y-2.5">
            <li v-for="r in missingRecommended" :key="r.code" class="flex items-center gap-2.5 text-sm">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-2xs font-semibold" :style="{ backgroundColor: tint(r.color, 14), color: r.color }" aria-hidden="true">{{ r.code }}</span>
              <span class="min-w-0 flex-1 truncate font-medium text-fg">{{ r.name }}</span>
              <span class="text-xs text-fg-muted tabular-nums">{{ 'annualQuota' in r && r.annualQuota ? `${r.annualQuota} / yr` : '' }}</span>
            </li>
          </ul>
          <AppButton class="mt-4 w-full" size="sm" variant="secondary" :icon="Sparkles" :loading="adding" @click="addRecommended">Add recommended</AppButton>
        </AppCard>
      </aside>
    </div>

    <LeaveTypeFormModal :open="modalOpen" :type="editing" @close="modalOpen = false" @saved="onSaved" />
  </div>
</template>
