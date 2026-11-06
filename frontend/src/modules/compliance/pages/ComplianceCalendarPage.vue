<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, ListPlus, Pencil, Plus, Trash2, Undo2 } from '@lucide/vue';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import FilingModal from '@/modules/compliance/components/FilingModal.vue';
import ObligationFormModal from '@/modules/compliance/components/ObligationFormModal.vue';
import type { CalendarItem, Obligation } from '@/modules/compliance/types';
import { FILING_STATE_LABELS, OBLIGATION_CATEGORY_LABELS, filingTone, localIso, scheduleLabel } from '@/modules/compliance/utils/compliance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Statutory due dates three months at a time (plus anything still overdue), and the obligations behind them. */
const feedback = useFeedbackStore();
const tab = ref('dates');
const tabs = [
  { key: 'dates', label: 'Due dates' },
  { key: 'obligations', label: 'Obligations' },
];
const start = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const range = computed(() => ({ from: localIso(start.value), to: localIso(new Date(start.value.getFullYear(), start.value.getMonth() + 3, 0)) }));
const rangeLabel = computed(() => {
  const f = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  return `${f.format(start.value)} – ${f.format(new Date(start.value.getFullYear(), start.value.getMonth() + 2, 1))}`;
});
const calendar = useAsync(() => complianceApi.calendar({ ...range.value, overdue: true }));
watch(range, () => void calendar.run());
function shift(months: number) {
  start.value = new Date(start.value.getFullYear(), start.value.getMonth() + months, 1);
}
const groups = computed(() => {
  const items = calendar.data.value?.items ?? [];
  const overdue = items.filter((i) => i.dueOn < range.value.from);
  const byMonth = new Map<string, CalendarItem[]>();
  for (const i of items.filter((x) => x.dueOn >= range.value.from)) byMonth.set(i.dueOn.slice(0, 7), [...(byMonth.get(i.dueOn.slice(0, 7)) ?? []), i]);
  const f = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  return [
    ...(overdue.length ? [{ key: 'overdue', title: 'Overdue from earlier months', items: overdue }] : []),
    ...[...byMonth.entries()].map(([k, v]) => ({ key: k, title: f.format(new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1)), items: v })),
  ];
});

const filing = ref<CalendarItem | null>(null);
async function onFiled() {
  filing.value = null;
  feedback.success('Filing recorded');
  await calendar.run();
}
async function undo(i: CalendarItem) {
  if (!(await feedback.confirm({ title: 'Remove this filing?', message: 'The due date shows as not filed again.', confirmLabel: 'Remove', danger: true }))) return;
  try {
    await complianceApi.unfile(i.filing!.id);
    feedback.success('Filing removed');
    await calendar.run();
  } catch (e) {
    feedback.error('Could not remove the filing', e);
  }
}
async function receipt(i: CalendarItem) {
  try {
    await complianceApi.downloadFiling(i.filing!.id, i.filing!.file!.name);
  } catch (e) {
    feedback.error('Could not download the receipt', e);
  }
}

const obligations = useAsync(() => complianceApi.obligations(), { immediate: false });
watch(tab, (t) => {
  if (t === 'obligations' && !obligations.data.value) void obligations.run();
});
const editing = ref<Obligation | null>(null);
const formOpen = ref(false);
function openForm(o: Obligation | null) {
  editing.value = o;
  formOpen.value = true;
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Obligation saved');
  await Promise.all([obligations.run(), calendar.run()]);
}
async function remove(o: Obligation) {
  if (!(await feedback.confirm({ title: `Delete ${o.title}?`, message: 'It is removed from the calendar.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await complianceApi.removeObligation(o.id);
    feedback.success('Obligation deleted');
    await Promise.all([obligations.run(), calendar.run()]);
  } catch (e) {
    feedback.error('Could not delete it', e);
  }
}
async function recommended() {
  if (!(await feedback.confirm({ title: 'Add the recommended obligations?', message: 'PF, ESI, TDS deposits and returns, Form 16, professional tax and the POSH annual report, tracked from today. Check the state-specific dates afterwards.', confirmLabel: 'Add' }))) return;
  try {
    const r = await complianceApi.addRecommended();
    feedback.success(r.added ? `${r.added} obligation${r.added === 1 ? '' : 's'} added` : 'Everything recommended is already in the calendar');
    await Promise.all([obligations.run(), calendar.run()]);
  } catch (e) {
    feedback.error('Could not add them', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Statutory calendar" description="Filings and payments due to authorities, and proof that they were made." back="/hr/compliance/policies" back-label="Policies">
      <template #actions>
        <AppButton variant="secondary" :icon="ListPlus" @click="recommended">Add recommended</AppButton>
        <AppButton :icon="Plus" @click="openForm(null)">New obligation</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <template v-if="tab === 'dates'">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Earlier months" @click="shift(-3)" />
          <span class="min-w-48 text-center text-sm font-medium text-fg">{{ rangeLabel }}</span>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Later months" @click="shift(3)" />
        </div>
        <div class="mb-6 grid gap-4 sm:grid-cols-3">
          <AppStatCard label="Overdue" :value="calendar.data.value?.counts.overdue" tone="danger" :loading="calendar.loading.value" />
          <AppStatCard label="Due in the next 7 days" :value="calendar.data.value?.counts.dueSoon" tone="warning" :loading="calendar.loading.value" />
          <AppStatCard label="Filed" :value="calendar.data.value?.counts.done" tone="success" :loading="calendar.loading.value" />
        </div>
        <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
        <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" @retry="calendar.run" />
        <AppCard v-else-if="!groups.length"><AppEmptyState :icon="ListPlus" title="Nothing due" description="Add the recommended statutory obligations or your own." /></AppCard>
        <div v-else class="space-y-6">
          <AppCard v-for="g in groups" :key="g.key" :title="g.title" :padded="false">
            <ul class="divide-y divide-line">
              <li v-for="i in g.items" :key="`${i.obligation.id}-${i.dueOn}`" class="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div class="w-20 shrink-0 text-xs font-medium text-fg-muted tabular-nums">{{ formatDate(i.dueOn) }}</div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-fg">{{ i.obligation.title }}</p>
                  <p class="text-xs text-fg-muted">
                    {{ OBLIGATION_CATEGORY_LABELS[i.obligation.category] }}{{ i.obligation.authority ? ` · ${i.obligation.authority}` : '' }}{{ i.obligation.owner ? ` · ${i.obligation.owner.name}` : '' }}
                    <template v-if="i.filing"> · filed {{ formatDate(i.filing.completedOn) }}{{ i.filing.late ? ' (late)' : '' }}{{ i.filing.reference ? `, ref ${i.filing.reference}` : '' }}{{ i.filing.completedBy ? ` by ${i.filing.completedBy}` : '' }}</template>
                  </p>
                </div>
                <AppBadge :tone="filingTone[i.state]" dot>{{ FILING_STATE_LABELS[i.state] }}</AppBadge>
                <div class="flex gap-1">
                  <template v-if="i.filing">
                    <AppButton v-if="i.filing.file" size="sm" variant="ghost" :icon="Download" :aria-label="`Receipt for ${i.obligation.title} due ${i.dueOn}`" @click="receipt(i)" />
                    <AppButton size="sm" variant="ghost" :icon="Undo2" :aria-label="`Remove the filing of ${i.obligation.title} due ${i.dueOn}`" @click="undo(i)" />
                  </template>
                  <AppButton v-else size="sm" variant="secondary" :icon="CheckCircle2" @click="filing = i">Mark filed</AppButton>
                </div>
              </li>
            </ul>
          </AppCard>
        </div>
      </template>

      <template v-else>
        <AppSkeleton v-if="obligations.loading.value && !obligations.data.value" :lines="6" />
        <AppErrorState v-else-if="obligations.error.value" :error="obligations.error.value" @retry="obligations.run" />
        <AppCard v-else-if="!obligations.data.value?.length"><AppEmptyState :icon="ListPlus" title="No obligations yet" description="Add the recommended statutory obligations or your own." /></AppCard>
        <AppCard v-else :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="o in obligations.data.value" :key="o.id" class="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ o.title }} <AppBadge v-if="!o.active" size="sm">Inactive</AppBadge></p>
                <p class="text-xs text-fg-muted">{{ OBLIGATION_CATEGORY_LABELS[o.category] }}{{ o.authority ? ` · ${o.authority}` : '' }} · due {{ scheduleLabel(o.dueDates) }} · from {{ formatDate(o.startsOn) }}{{ o.endsOn ? ` to ${formatDate(o.endsOn)}` : '' }}</p>
                <p v-if="o.description" class="text-xs text-fg-muted">{{ o.description }}</p>
              </div>
              <span class="text-xs text-fg-muted">{{ o.filings ?? 0 }} filing{{ o.filings === 1 ? '' : 's' }}</span>
              <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${o.title}`" @click="openForm(o)" />
              <AppButton v-if="!o.filings" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${o.title}`" @click="remove(o)" />
            </li>
          </ul>
        </AppCard>
      </template>
    </AppTabs>
    <FilingModal :item="filing" @close="filing = null" @saved="onFiled" />
    <ObligationFormModal :open="formOpen" :obligation="editing" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
