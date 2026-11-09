<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Ban, BriefcaseBusiness, Building2, CalendarDays, Check, CircleDollarSign, ClipboardList, FilePlus2, Hourglass, MapPin, Pencil, Plus, Send, UserRound, Users, X } from '@lucide/vue';
import type { RequisitionStatus } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import RequisitionFormModal from '@/modules/recruitment/components/RequisitionFormModal.vue';
import RequisitionGridCard from '@/modules/recruitment/components/RequisitionGridCard.vue';
import type { JobDetail, Requisition } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, PIPELINE_ORDER, REASON_LABELS, REQUISITION_STATUS_LABELS, STAGE_LABELS, jobTone, money, requisitionTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { daysSince, dueText, dueTone } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSearchInput, AppStatStrip, AppTabs, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** Requests to hire: the approval queue first, then everything the user can see, with status figures that filter the list. */
type View = 'approve' | 'mine' | 'all';
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canCreate = computed(() => auth.can('recruitment.requisition.create'));
const canApprove = computed(() => auth.can('recruitment.requisition.approve'));
const canManage = computed(() => auth.can('recruitment.manage'));
const view = ref<View>(canApprove.value ? 'approve' : canCreate.value ? 'mine' : 'all');
const table = useTable((q) => recruitmentApi.requisitions({ ...q, view: view.value }), { filters: { status: undefined as RequisitionStatus | undefined } });

// Figures: every row of the current view, and the size of each tab.
const summary = useAsync(() => fetchAllPages((page, pageSize) => recruitmentApi.requisitions({ view: view.value, page, pageSize })));
const tabKeys = computed<View[]>(() => [...(canApprove.value ? ['approve' as const] : []), ...(canCreate.value ? ['mine' as const] : []), 'all']);
const tabTotals = useAsync(async () => Object.fromEntries(await Promise.all(tabKeys.value.map(async (k) => [k, (await recruitmentApi.requisitions({ view: k, pageSize: 1 })).meta.total] as const))));
const tabs = computed(() => [
  ...(canApprove.value ? [{ key: 'approve', label: 'To approve', icon: Hourglass, count: tabTotals.data.value?.approve ?? null }] : []),
  ...(canCreate.value ? [{ key: 'mine', label: 'Raised by me', icon: UserRound, count: tabTotals.data.value?.mine ?? null }] : []),
  { key: 'all', label: 'All requisitions', icon: ClipboardList, count: tabTotals.data.value?.all ?? null },
]);
watch(view, (v) => {
  if (v === 'approve') table.filters.status = undefined;
  void table.load();
  void summary.run();
});
async function refresh() {
  await Promise.all([table.load(), summary.run(), tabTotals.run()]);
}

const all = computed(() => summary.data.value ?? []);
const byStatus = (s: RequisitionStatus) => all.value.filter((r) => r.status === s);
const waitingDays = (r: Requisition) => daysSince(r.submittedAt ?? r.createdAt);
const strip = computed<StripItem[]>(() => {
  const pending = byStatus('PENDING_APPROVAL');
  const oldest = pending.length ? Math.max(...pending.map(waitingDays)) : 0;
  const approved = byStatus('APPROVED');
  const noJob = approved.filter((r) => !r.job).length;
  const filled = byStatus('FILLED');
  return [
    { key: 'PENDING_APPROVAL', label: 'Awaiting approval', value: pending.length, tone: 'warning', hint: pending.length ? `Oldest waiting ${oldest === 0 ? 'since today' : `${oldest} day${oldest === 1 ? '' : 's'}`}` : 'Nothing waiting' },
    { key: 'APPROVED', label: 'Approved', value: approved.length, tone: 'success', hint: noJob ? `${noJob} without a job yet` : approved.length ? 'All have a job' : 'Ready to hire against' },
    { key: 'DRAFT', label: 'Drafts', value: byStatus('DRAFT').length, tone: 'neutral', hint: 'Not submitted yet' },
    { key: 'FILLED', label: 'Filled', value: filled.length, tone: 'info', hint: `${filled.reduce((n, r) => n + r.hiredCount, 0)} people hired` },
    { key: 'REJECTED', label: 'Rejected', value: byStatus('REJECTED').length, tone: 'danger', hint: 'Can be edited and resubmitted' },
    { key: 'CANCELLED', label: 'Cancelled', value: byStatus('CANCELLED').length, tone: '#94a3b8', hint: 'Withdrawn by the team' },
  ];
});
/** Decisions this user can make, shown as a banner on the other tabs. */
const myDecisions = computed(() => (view.value === 'approve' ? 0 : (tabTotals.data.value?.approve ?? 0)));

const formOpen = ref(false);
const editing = ref<Requisition | null>(null);
function openForm(r: Requisition | null = null) {
  editing.value = r;
  formOpen.value = true;
}
async function onSaved(r: Requisition) {
  formOpen.value = false;
  selected.value = null;
  feedback.success(r.status === 'PENDING_APPROVAL' ? 'Requisition submitted for approval' : 'Draft saved');
  await refresh();
}

const selected = ref<Requisition | null>(null);
const decision = ref<'approve' | 'reject' | null>(null);
const note = ref('');
const busy = ref(false);
function review(r: Requisition, d: 'approve' | 'reject' | null = null) {
  selected.value = r;
  decision.value = d;
  note.value = '';
}
async function decide() {
  const r = selected.value!;
  busy.value = true;
  try {
    selected.value = decision.value === 'approve' ? await recruitmentApi.approveRequisition(r.id, note.value || null) : await recruitmentApi.rejectRequisition(r.id, note.value);
    feedback.success(decision.value === 'approve' ? 'Requisition approved' : 'Requisition rejected', `${r.requestedBy ?? 'The requester'} has been notified.`);
    decision.value = null;
    await refresh();
  } catch (e) {
    feedback.error('Could not record the decision', e);
  } finally {
    busy.value = false;
  }
}
async function cancel(r: Requisition) {
  if (!(await feedback.confirm({ title: `Cancel ${r.code}?`, message: 'Its job, if any, is closed.', confirmLabel: 'Cancel requisition', danger: true }))) return;
  try {
    selected.value = await recruitmentApi.cancelRequisition(r.id);
    feedback.success('Requisition cancelled');
    await refresh();
  } catch (e) {
    feedback.error('Could not cancel the requisition', e);
  }
}

const jobOpen = ref(false);
const jobFor = ref<Requisition | null>(null);
function openJob(r: Requisition) {
  jobFor.value = r;
  jobOpen.value = true;
}
async function onJobCreated(job: JobDetail) {
  jobOpen.value = false;
  selected.value = null;
  feedback.success('Job created', 'Open it when you are ready to receive applications.');
  await router.push(`/hr/recruitment/jobs/${job.id}`);
}

/** Approvers weigh headcount and budget; everyone else follows hiring progress. */
const columns = computed<TableColumn<Requisition>[]>(() =>
  view.value === 'approve'
    ? [
        { key: 'title', label: 'Position' },
        { key: 'requestedBy', label: 'Requested by' },
        { key: 'headcount', label: 'Openings', align: 'right' },
        { key: 'budget', label: 'Budget (annual CTC)' },
        { key: 'targetDate', label: 'Needed by' },
        { key: 'status', label: 'Status' },
        { key: 'actions', label: '', align: 'right' },
      ]
    : [
        { key: 'title', label: 'Position' },
        { key: 'requestedBy', label: 'Requested by' },
        { key: 'openings', label: 'Hired', align: 'right' },
        { key: 'targetDate', label: 'Needed by' },
        { key: 'status', label: 'Status' },
        { key: 'job', label: 'Hiring' },
      ],
);
const pipelineTotal = (r: Requisition) => Object.values(r.job?.pipeline ?? {}).reduce((n, v) => n + (v ?? 0), 0);
const pipelineText = (r: Requisition) =>
  r.job ? Object.entries(r.job.pipeline).map(([s, n]) => `${n} ${STAGE_LABELS[s as keyof typeof STAGE_LABELS].toLowerCase()}`).join(' · ') || 'No candidates yet' : '';
const place = (r: Requisition) => [r.department?.name, r.location?.name, REASON_LABELS[r.reason]].filter(Boolean).join(' · ');
const budget = (r: Requisition) => (r.budgetMin || r.budgetMax ? `${money(r.budgetMin)} – ${money(r.budgetMax)}` : null);
const isOpen = (r: Requisition) => !['FILLED', 'CANCELLED', 'REJECTED'].includes(r.status);

/** The requisition's history, newest last: raised, submitted, decided, job opened, hires. */
const trail = computed(() => {
  const r = selected.value;
  if (!r) return [];
  const steps: { key: string; title: string; detail?: string; at?: string | null; tone: string; icon: typeof Check }[] = [
    { key: 'raised', title: `Raised by ${r.requestedBy ?? 'a team member'}`, at: r.createdAt, tone: 'bg-surface-muted text-fg-muted', icon: FilePlus2 },
  ];
  if (r.submittedAt) steps.push({ key: 'submitted', title: 'Submitted for approval', at: r.submittedAt, tone: 'bg-warning-soft text-warning-fg', icon: Send });
  if (r.reviewedBy && r.reviewedAt)
    steps.push({
      key: 'decided',
      title: `${r.status === 'REJECTED' ? 'Rejected' : 'Approved'} by ${r.reviewedBy}`,
      detail: r.reviewNote ? `“${r.reviewNote}”` : undefined,
      at: r.reviewedAt,
      tone: r.status === 'REJECTED' ? 'bg-danger-soft text-danger-fg' : 'bg-success-soft text-success-fg',
      icon: r.status === 'REJECTED' ? X : Check,
    });
  else if (r.status === 'PENDING_APPROVAL') steps.push({ key: 'waiting', title: 'Waiting for an approver', detail: `Someone other than ${r.requestedBy ?? 'the requester'} decides.`, tone: 'border border-dashed border-line-strong bg-surface text-fg-subtle', icon: Hourglass });
  if (r.job) steps.push({ key: 'job', title: `Job ${JOB_STATUS_LABELS[r.job.status].toLowerCase()}`, detail: pipelineText(r), tone: 'bg-accent-soft text-accent-fg', icon: BriefcaseBusiness });
  if (r.hiredCount) steps.push({ key: 'hired', title: `${r.hiredCount} of ${r.openings} hired`, tone: 'bg-success-soft text-success-fg', icon: Users });
  if (r.status === 'CANCELLED') steps.push({ key: 'cancelled', title: 'Cancelled', tone: 'bg-surface-muted text-fg-muted', icon: Ban });
  return steps;
});
const facts = computed(() => {
  const r = selected.value;
  if (!r) return [];
  return [
    { label: 'Department', value: r.department?.name ?? '—', icon: Building2 },
    { label: 'Designation', value: r.designation?.name ?? '—', icon: BriefcaseBusiness },
    { label: 'Location', value: r.location?.name ?? '—', icon: MapPin },
    { label: 'Hiring manager', value: r.hiringManager?.name ?? '—', icon: UserRound },
    { label: 'Budget (annual CTC)', value: budget(r) ?? '—', icon: CircleDollarSign },
    { label: 'Needed by', value: r.targetDate ? `${formatDate(r.targetDate)}${isOpen(r) ? ` · ${dueText(r.targetDate).toLowerCase()}` : ''}` : '—', icon: CalendarDays },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Requisitions" description="Requests to hire. A requisition must be approved by someone other than the requester before a job is opened.">
      <template v-if="canCreate" #actions>
        <AppButton :icon="Plus" @click="openForm()">New requisition</AppButton>
      </template>
    </AppPageHeader>

    <div v-if="myDecisions" class="card flex flex-wrap items-center gap-3 border-warning/40 bg-warning-soft/40 px-4 py-3" role="status">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg" aria-hidden="true"><Hourglass :size="17" /></span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-fg">{{ myDecisions }} requisition{{ myDecisions === 1 ? ' is' : 's are' }} waiting for your approval</p>
        <p class="text-xs text-fg-muted">Hiring can't start until someone decides. Approve or reject with a note for the requester.</p>
      </div>
      <AppButton size="sm" :icon-right="ArrowRight" @click="view = 'approve'">Review now</AppButton>
    </div>

    <AppTabs v-model="view" :tabs="tabs">
      <!-- The approval queue only holds requisitions awaiting approval, so status figures add nothing there. -->
      <AppStatStrip
        v-if="view !== 'approve'"
        class="mb-4"
        :items="strip"
        :loading="summary.loading.value && !summary.data.value"
        selectable
        :selected="table.filters.status ?? null"
        label="Requisitions by status"
        @select="(k) => (table.filters.status = (k as RequisitionStatus | null) ?? undefined)"
      />
      <AppCard :padded="false">
        <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          <AppSearchInput v-model="table.search.value" class="min-w-60 flex-1" placeholder="Search by position or code" aria-label="Search requisitions" />
          <span v-if="table.filters.status" class="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            Showing
            <AppBadge :tone="requisitionTone[table.filters.status]" dot>{{ REQUISITION_STATUS_LABELS[table.filters.status] }}</AppBadge>
            <AppButton size="xs" variant="ghost" :icon="X" :aria-label="`Show all statuses`" @click="table.filters.status = undefined" />
          </span>
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Requisitions"
          :empty-title="view === 'approve' ? 'Nothing to approve' : view === 'mine' ? 'You haven\'t raised a requisition' : 'No requisitions'"
          :empty-description="
            view === 'approve'
              ? 'You are all caught up. New requests from managers appear here for your decision.'
              : canCreate
                ? 'Raise a requisition to request headcount. Once approved, recruiters open a job against it.'
                : undefined
          "
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => review(row)"
          :filtered="table.isFiltered.value"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton v-if="canCreate && view !== 'approve'" :icon="Plus" @click="openForm()">New requisition</AppButton></template>
          <template #cell-title="{ row }">
            <div class="flex items-center gap-3">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', row.status === 'PENDING_APPROVAL' ? 'bg-warning-soft text-warning-fg' : 'bg-accent-soft text-accent-fg']" aria-hidden="true">
                <ClipboardList :size="16" />
              </span>
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.title }}</p>
                <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ row.code }}</span> · {{ place(row) }}</p>
              </div>
            </div>
          </template>
          <template #cell-requestedBy="{ row }">
            <div v-if="row.requestedBy" class="flex items-center gap-2">
              <AppAvatar :name="row.requestedBy" size="xs" />
              <div class="min-w-0">
                <p class="truncate text-sm text-fg">{{ row.requestedBy }}</p>
                <p class="text-2xs text-fg-subtle">{{ timeAgo(row.submittedAt ?? row.createdAt) }}</p>
              </div>
            </div>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-openings="{ row }">
            <div class="ms-auto w-20">
              <p class="text-sm text-fg tabular-nums"><span class="font-semibold">{{ row.hiredCount }}</span><span class="text-fg-muted">/{{ row.openings }}</span></p>
              <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div class="h-full rounded-full bg-success" :style="{ width: `${(row.hiredCount / Math.max(1, row.openings)) * 100}%` }" />
              </div>
            </div>
          </template>
          <template #cell-headcount="{ row }"><span class="font-semibold text-fg tabular-nums">{{ row.openings }}</span></template>
          <template #cell-budget="{ row }">
            <span v-if="budget(row)" class="text-sm text-fg tabular-nums">{{ budget(row) }}</span>
            <span v-else class="text-xs text-fg-subtle">Not set</span>
          </template>
          <template #cell-targetDate="{ row }">
            <template v-if="row.targetDate">
              <p class="text-sm text-fg">{{ formatDate(row.targetDate) }}</p>
              <p v-if="isOpen(row)" :class="['text-2xs font-medium', dueTone(row.targetDate)]">{{ dueText(row.targetDate) }}</p>
            </template>
            <span v-else class="text-xs text-fg-subtle">No date</span>
          </template>
          <template #cell-status="{ row }">
            <div>
              <AppBadge :tone="requisitionTone[row.status]" dot>{{ REQUISITION_STATUS_LABELS[row.status] }}</AppBadge>
              <p v-if="row.status === 'PENDING_APPROVAL'" :class="['mt-0.5 text-2xs', waitingDays(row) >= 3 ? 'font-medium text-warning-fg' : 'text-fg-subtle']">
                Waiting {{ waitingDays(row) === 0 ? 'since today' : `${waitingDays(row)} day${waitingDays(row) === 1 ? '' : 's'}` }}
              </p>
              <p v-else-if="row.reviewedBy" class="mt-0.5 truncate text-2xs text-fg-subtle">by {{ row.reviewedBy }}</p>
            </div>
          </template>
          <template #cell-job="{ row }">
            <div v-if="row.job" class="min-w-36">
              <div class="flex items-center gap-2">
                <AppBadge :tone="jobTone[row.job.status]" size="sm">{{ JOB_STATUS_LABELS[row.job.status] }}</AppBadge>
                <span class="text-xs text-fg-muted tabular-nums">{{ pipelineTotal(row) }} candidate{{ pipelineTotal(row) === 1 ? '' : 's' }}</span>
              </div>
              <div v-if="pipelineTotal(row)" class="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" :title="pipelineText(row)" aria-hidden="true">
                <div v-for="s in PIPELINE_ORDER" :key="s" :class="stageAccent[s]" :style="{ width: `${((row.job.pipeline[s] ?? 0) / pipelineTotal(row)) * 100}%` }" />
              </div>
              <span class="sr-only">{{ pipelineText(row) }}</span>
            </div>
            <AppButton v-else-if="row.status === 'APPROVED' && canManage" size="xs" variant="outline" :icon="BriefcaseBusiness" @click.stop="openJob(row)">Open job</AppButton>
            <span v-else class="text-xs text-fg-subtle">—</span>
          </template>
          <template #card="{ row }">
            <RequisitionGridCard :requisition="row" :can-manage="canManage" @approve="review(row, 'approve')" @reject="review(row, 'reject')" @open-job="openJob(row)" />
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.permissions.decide" class="flex justify-end gap-1.5">
              <AppButton size="xs" variant="secondary" :icon="X" @click.stop="review(row, 'reject')">Reject</AppButton>
              <AppButton size="xs" :icon="Check" @click.stop="review(row, 'approve')">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="!!selected" :title="selected ? selected.title : ''" :description="selected ? `${selected.code} · requested by ${selected.requestedBy ?? 'a team member'} ${timeAgo(selected.createdAt)}` : undefined" size="lg" :guide="false" @close="selected = null; decision = null">
      <template v-if="selected">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <AppBadge :tone="requisitionTone[selected.status]" dot>{{ REQUISITION_STATUS_LABELS[selected.status] }}</AppBadge>
          <AppBadge>{{ REASON_LABELS[selected.reason] }}</AppBadge>
          <AppBadge>{{ EMPLOYMENT_TYPE_LABELS[selected.employmentType] }}</AppBadge>
          <span class="ms-auto inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <Users :size="14" aria-hidden="true" /><span class="font-semibold text-fg tabular-nums">{{ selected.openings }}</span> opening{{ selected.openings === 1 ? '' : 's' }} · {{ selected.hiredCount }} hired
          </span>
        </div>
        <dl class="grid gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60 sm:grid-cols-2">
          <div v-for="f in facts" :key="f.label" class="flex min-w-0 items-start gap-3 bg-surface px-3.5 py-3">
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="14" /></span>
            <div class="min-w-0">
              <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
              <dd class="mt-0.5 truncate text-sm text-fg" :title="f.value">{{ f.value }}</dd>
            </div>
          </div>
        </dl>
        <div class="mt-4">
          <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Justification</p>
          <p class="mt-1.5 rounded-lg border-s-2 border-brand-500 bg-surface-muted/60 px-3.5 py-2.5 text-sm whitespace-pre-line text-fg">{{ selected.justification }}</p>
        </div>
        <div class="mt-5">
          <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Progress</p>
          <ol class="mt-2 space-y-3">
            <li v-for="(s, i) in trail" :key="s.key" class="relative flex gap-3">
              <span v-if="i < trail.length - 1" class="absolute start-[13px] top-7 -bottom-3 w-px bg-line" aria-hidden="true" />
              <span :class="['relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full', s.tone]" aria-hidden="true"><component :is="s.icon" :size="13" /></span>
              <div class="min-w-0 pt-0.5">
                <p class="text-sm font-medium text-fg">{{ s.title }}</p>
                <p v-if="s.detail" class="text-sm text-fg-muted">{{ s.detail }}</p>
                <p v-if="s.at" class="text-2xs text-fg-subtle">{{ formatDateTime(s.at) }}</p>
              </div>
            </li>
          </ol>
        </div>
        <div v-if="decision" class="mt-4 rounded-lg border border-line p-3.5" :class="decision === 'approve' ? 'bg-success-soft/30' : 'bg-danger-soft/30'">
          <p class="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <component :is="decision === 'approve' ? Check : X" :size="15" :class="decision === 'approve' ? 'text-success-fg' : 'text-danger-fg'" aria-hidden="true" />
            {{ decision === 'approve' ? 'Approve this requisition' : 'Reject this requisition' }}
          </p>
          <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'Reason'" :required="decision === 'reject'" :rows="2" :maxlength="500" :placeholder="decision === 'approve' ? 'e.g. Budget confirmed with finance' : 'Tell the requester what to change'" />
        </div>
      </template>
      <template #footer>
        <template v-if="selected && decision">
          <AppButton variant="secondary" @click="decision = null">Cancel</AppButton>
          <AppButton :variant="decision === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="decision === 'reject' && note.trim().length < 3" @click="decide">{{ decision === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
        </template>
        <template v-else-if="selected">
          <AppButton v-if="!['CANCELLED', 'FILLED'].includes(selected.status) && (selected.permissions.edit || canManage)" variant="ghost" :icon="Ban" @click="cancel(selected)">Cancel requisition</AppButton>
          <AppButton v-if="selected.permissions.edit" variant="secondary" :icon="Pencil" @click="openForm(selected)">Edit</AppButton>
          <template v-if="selected.permissions.decide">
            <AppButton variant="secondary" :icon="X" @click="decision = 'reject'; note = ''">Reject</AppButton>
            <AppButton :icon="Check" @click="decision = 'approve'; note = ''">Approve</AppButton>
          </template>
          <AppButton v-if="selected.status === 'APPROVED' && !selected.job && canManage" :icon="BriefcaseBusiness" @click="openJob(selected)">Open job</AppButton>
          <AppButton v-if="selected.job && auth.can('recruitment.view')" variant="secondary" :icon-right="ArrowRight" :to="`/hr/recruitment/jobs/${selected.job.id}`">View job</AppButton>
        </template>
      </template>
    </AppModal>

    <RequisitionFormModal :open="formOpen" :requisition="editing" @close="formOpen = false" @saved="onSaved" />
    <JobFormModal :open="jobOpen" :job="null" :requisition="jobFor" @close="jobOpen = false" @saved="onJobCreated" />
  </div>
</template>
