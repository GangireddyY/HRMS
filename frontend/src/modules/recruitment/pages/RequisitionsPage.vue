<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Ban, BriefcaseBusiness, Check, Pencil, Plus, X } from '@lucide/vue';
import type { RequisitionStatus } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import RequisitionFormModal from '@/modules/recruitment/components/RequisitionFormModal.vue';
import type { JobDetail, Requisition } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, REASON_LABELS, REQUISITION_STATUS_LABELS, STAGE_LABELS, jobTone, money, requisitionTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canCreate = computed(() => auth.can('recruitment.requisition.create'));
const canApprove = computed(() => auth.can('recruitment.requisition.approve'));
const canManage = computed(() => auth.can('recruitment.manage'));
const tabs = computed(() => [
  ...(canApprove.value ? [{ key: 'approve', label: 'To approve' }] : []),
  ...(canCreate.value ? [{ key: 'mine', label: 'Mine' }] : []),
  { key: 'all', label: 'All' },
]);
const view = ref<'approve' | 'mine' | 'all'>(canApprove.value ? 'approve' : canCreate.value ? 'mine' : 'all');
const table = useTable((q) => recruitmentApi.requisitions({ ...q, view: view.value }), { filters: { status: undefined as RequisitionStatus | undefined } });
watch(view, () => void table.load());
const statusOptions = (Object.keys(REQUISITION_STATUS_LABELS) as RequisitionStatus[]).map((s) => ({ value: s, label: REQUISITION_STATUS_LABELS[s] }));

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
  await table.load();
}

const selected = ref<Requisition | null>(null);
const decision = ref<'approve' | 'reject' | null>(null);
const note = ref('');
const busy = ref(false);
async function decide() {
  const r = selected.value!;
  busy.value = true;
  try {
    selected.value = decision.value === 'approve' ? await recruitmentApi.approveRequisition(r.id, note.value || null) : await recruitmentApi.rejectRequisition(r.id, note.value);
    feedback.success(decision.value === 'approve' ? 'Requisition approved' : 'Requisition rejected', `${r.requestedBy ?? 'The requester'} has been notified.`);
    decision.value = null;
    await table.load();
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
    await table.load();
  } catch (e) {
    feedback.error('Could not cancel the requisition', e);
  }
}

const jobOpen = ref(false);
async function onJobCreated(job: JobDetail) {
  jobOpen.value = false;
  selected.value = null;
  feedback.success('Job created', 'Open it when you are ready to receive applications.');
  await router.push(`/hr/recruitment/jobs/${job.id}`);
}

const columns: TableColumn<Requisition>[] = [
  { key: 'title', label: 'Position' },
  { key: 'department', label: 'Department' },
  { key: 'openings', label: 'Openings', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'job', label: 'Job' },
];
const pipelineText = (r: Requisition) =>
  r.job ? Object.entries(r.job.pipeline).map(([s, n]) => `${n} ${STAGE_LABELS[s as keyof typeof STAGE_LABELS].toLowerCase()}`).join(' · ') || 'No candidates yet' : '';
</script>

<template>
  <div>
    <AppPageHeader title="Requisitions" description="Requests to hire. A requisition must be approved by someone other than the requester before a job is opened.">
      <template v-if="canCreate" #actions>
        <AppButton :icon="Plus" @click="openForm()">New requisition</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="table.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Requisitions"
          :empty-title="view === 'approve' ? 'Nothing to approve' : 'No requisitions'"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => (selected = row)"
        >
          <template #cell-title="{ row }">
            <p class="font-medium text-fg">{{ row.title }}</p>
            <p class="text-xs text-fg-muted">{{ row.code }} · {{ row.requestedBy }} · {{ timeAgo(row.createdAt) }}</p>
          </template>
          <template #cell-department="{ row }"><span class="text-fg-muted">{{ row.department?.name ?? '—' }}</span></template>
          <template #cell-openings="{ row }"><span class="tabular-nums">{{ row.hiredCount }}/{{ row.openings }}</span></template>
          <template #cell-status="{ row }"><AppBadge :tone="requisitionTone[row.status]" dot>{{ REQUISITION_STATUS_LABELS[row.status] }}</AppBadge></template>
          <template #cell-job="{ row }">
            <template v-if="row.job">
              <AppBadge :tone="jobTone[row.job.status]" size="sm">{{ JOB_STATUS_LABELS[row.job.status] }}</AppBadge>
              <p class="mt-0.5 text-xs text-fg-muted">{{ pipelineText(row) }}</p>
            </template>
            <span v-else class="text-xs text-fg-subtle">—</span>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="!!selected" :title="selected ? `${selected.code} · ${selected.title}` : ''" size="lg" @close="selected = null; decision = null">
      <template v-if="selected">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <AppBadge :tone="requisitionTone[selected.status]" dot>{{ REQUISITION_STATUS_LABELS[selected.status] }}</AppBadge>
          <AppBadge>{{ REASON_LABELS[selected.reason] }}</AppBadge>
          <AppBadge>{{ EMPLOYMENT_TYPE_LABELS[selected.employmentType] }}</AppBadge>
        </div>
        <dl class="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-fg-muted">Department</dt><dd class="text-fg">{{ selected.department?.name ?? '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Designation</dt><dd class="text-fg">{{ selected.designation?.name ?? '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Hiring manager</dt><dd class="text-fg">{{ selected.hiringManager?.name ?? '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Openings</dt><dd class="text-fg">{{ selected.openings }} ({{ selected.hiredCount }} hired)</dd></div>
          <div><dt class="text-xs text-fg-muted">Budget (annual CTC)</dt><dd class="text-fg">{{ selected.budgetMin || selected.budgetMax ? `${money(selected.budgetMin)} – ${money(selected.budgetMax)}` : '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Needed by</dt><dd class="text-fg">{{ selected.targetDate ? formatDate(selected.targetDate) : '—' }}</dd></div>
          <div class="sm:col-span-2"><dt class="text-xs text-fg-muted">Justification</dt><dd class="whitespace-pre-line text-fg">{{ selected.justification }}</dd></div>
          <div v-if="selected.reviewedBy" class="sm:col-span-2">
            <dt class="text-xs text-fg-muted">Decision</dt>
            <dd class="text-fg">{{ REQUISITION_STATUS_LABELS[selected.status] }} by {{ selected.reviewedBy }}{{ selected.reviewNote ? ` — “${selected.reviewNote}”` : '' }}</dd>
          </div>
        </dl>
        <div v-if="decision" class="mt-4 border-t border-line pt-4">
          <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'Reason'" :required="decision === 'reject'" :rows="2" :maxlength="500" />
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
          <AppButton v-if="selected.status === 'APPROVED' && !selected.job && canManage" :icon="BriefcaseBusiness" @click="jobOpen = true">Open job</AppButton>
          <AppButton v-if="selected.job && auth.can('recruitment.view')" variant="secondary" :to="`/hr/recruitment/jobs/${selected.job.id}`">View job</AppButton>
        </template>
      </template>
    </AppModal>

    <RequisitionFormModal :open="formOpen" :requisition="editing" @close="formOpen = false" @saved="onSaved" />
    <JobFormModal :open="jobOpen" :job="null" :requisition="selected" @close="jobOpen = false" @saved="onJobCreated" />
  </div>
</template>
