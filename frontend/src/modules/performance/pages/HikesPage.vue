<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, PiggyBank, Send, SlidersHorizontal, TrendingUp, Wand2, XCircle } from '@lucide/vue';
import { HIKE_STATUSES, MAX_HIKE_PERCENT, type HikeStatus, type MeritGuideline } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { Compensation, HikeList, HikeRow } from '@/modules/performance/types';
import { HIKE_STATUS_LABELS, hikeTone } from '@/modules/performance/utils/performance-format';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDataTable, AppDatePicker, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppStatCard, AppTextarea, type TableColumn } from '@/shared/components';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/**
 * Salary increases after a review cycle. Reviewers recommend an increase for each completed review (within the cycle's
 * merit guideline, or outside it with a reason) and submit it; HR with salary-revision rights approves or rejects and
 * applies the approved ones as salary revisions. Amounts appear only where the viewer can see the employee's salary.
 */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const hr = computed(() => auth.can('performance.configure') || auth.can('employee.salary.revise'));

const view = ref<'mine' | 'all'>(hr.value ? 'all' : 'mine');
const status = ref<HikeStatus | undefined>(undefined);
const list = ref<HikeList | null>(null);
const comp = ref<Compensation | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [rows, settings] = await Promise.all([performanceApi.hikes(id.value, { view: view.value, status: status.value }), hr.value ? performanceApi.compensation(id.value) : Promise.resolve(null)]);
    list.value = rows;
    comp.value = settings;
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
void load();
watch([id, view, status], () => void load());

const viewOptions = [
  { value: 'all', label: 'Everyone in the cycle' },
  { value: 'mine', label: 'People I reviewed' },
];
const statusOptions = HIKE_STATUSES.map((s) => ({ value: s, label: HIKE_STATUS_LABELS[s] }));
const rows = computed(() => list.value?.rows ?? []);
const showMoney = computed(() => rows.value.some((r) => r.currentCtc !== undefined));
const columns = computed<TableColumn<HikeRow>[]>(() => [
  { key: 'employee', label: 'Employee' },
  { key: 'rating', label: 'Rating' },
  { key: 'guideline', label: 'Guideline' },
  ...(showMoney.value ? [{ key: 'current', label: 'Current CTC', align: 'right' as const }] : []),
  { key: 'increase', label: 'Increase', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
]);
const range = (g: MeritGuideline) => (g.max === 0 ? 'No increase' : `${g.min}–${g.max}% · target ${g.target}%`);

const { fieldErrors, formError, handle, reset } = useFormErrors();
const busy = ref(false);
const modal = ref<'recommend' | 'approve' | 'reject' | 'guidelines' | null>(null);
const current = ref<HikeRow | null>(null);

function replace(row: HikeRow | null) {
  if (!row || !list.value) return;
  list.value = { ...list.value, rows: list.value.rows.map((r) => (r.reviewId === row.reviewId ? row : r)) };
}
async function refreshComp() {
  if (hr.value) comp.value = await performanceApi.compensation(id.value);
}

const recForm = reactive({ percent: '' as string | number, promotion: false, justification: '' });
const recOutside = computed(() => {
  const g = current.value?.guideline;
  const p = Number(recForm.percent);
  return !!g && recForm.percent !== '' && (p < g.min || p > g.max);
});
const preview = (row: HikeRow | null, percent: string | number) => (row?.currentCtc && percent !== '' ? Math.round((row.currentCtc * (100 + Number(percent))) / 100) : null);
function openRecommend(row: HikeRow) {
  reset();
  current.value = row;
  const r = row.recommendation;
  Object.assign(recForm, { percent: r?.percent ?? row.guideline.target, promotion: r?.promotion ?? false, justification: r?.justification ?? '' });
  modal.value = 'recommend';
}
async function saveRecommendation(submit: boolean) {
  reset();
  busy.value = true;
  try {
    let row = await performanceApi.recommendHike(current.value!.reviewId, { percent: Number(recForm.percent), promotion: recForm.promotion, justification: recForm.justification.trim() || null });
    if (submit && row?.recommendation) row = await performanceApi.submitHike(row.recommendation.id);
    replace(row);
    await refreshComp();
    modal.value = null;
    feedback.success(submit ? 'Recommendation submitted' : 'Draft saved', submit ? 'HR has been asked to approve it.' : undefined);
  } catch (e) {
    handle(e, 'Could not save the recommendation');
  } finally {
    busy.value = false;
  }
}
async function submit(row: HikeRow) {
  busy.value = true;
  try {
    replace(await performanceApi.submitHike(row.recommendation!.id));
    await refreshComp();
    feedback.success('Recommendation submitted', 'HR has been asked to approve it.');
  } catch (e) {
    feedback.error('Could not submit it', e);
  } finally {
    busy.value = false;
  }
}

const decideForm = reactive({ percent: '' as string | number, note: '' });
function openDecide(row: HikeRow, kind: 'approve' | 'reject') {
  reset();
  current.value = row;
  Object.assign(decideForm, { percent: row.recommendation!.percent, note: '' });
  modal.value = kind;
}
async function decide(approve: boolean) {
  reset();
  busy.value = true;
  const recId = current.value!.recommendation!.id;
  try {
    const row = approve
      ? await performanceApi.approveHike(recId, { percent: Number(decideForm.percent), note: decideForm.note.trim() || null })
      : await performanceApi.rejectHike(recId, decideForm.note.trim());
    replace(row);
    await refreshComp();
    modal.value = null;
    feedback.success(approve ? 'Increase approved' : 'Sent back to the reviewer');
  } catch (e) {
    handle(e, 'Could not record the decision');
  } finally {
    busy.value = false;
  }
}

const GUIDE_FIELDS = [
  { key: 'min', label: 'Minimum %' },
  { key: 'target', label: 'Target %' },
  { key: 'max', label: 'Maximum %' },
] as const;
const guideForm = reactive({ matrix: [] as { rating: number; min: string | number; target: string | number; max: string | number }[], budgetPercent: '' as string | number, effectiveFrom: undefined as string | undefined });
function openGuidelines() {
  reset();
  const c = comp.value!;
  guideForm.matrix = [...c.meritMatrix].sort((a, b) => b.rating - a.rating).map((g) => ({ ...g }));
  guideForm.budgetPercent = c.budgetPercent ?? '';
  guideForm.effectiveFrom = c.effectiveFrom ?? undefined;
  modal.value = 'guidelines';
}
async function saveGuidelines() {
  reset();
  busy.value = true;
  try {
    comp.value = await performanceApi.setCompensation(id.value, {
      meritMatrix: guideForm.matrix.map((g) => ({ rating: g.rating, min: Number(g.min), target: Number(g.target), max: Number(g.max) })),
      budgetPercent: guideForm.budgetPercent === '' ? null : Number(guideForm.budgetPercent),
      effectiveFrom: guideForm.effectiveFrom ?? null,
    });
    modal.value = null;
    feedback.success('Guidelines saved');
    await load();
  } catch (e) {
    handle(e, 'Could not save the guidelines');
  } finally {
    busy.value = false;
  }
}

const failed = ref<{ employee: string; reason: string }[]>([]);
async function apply() {
  const c = comp.value!;
  if (!(await feedback.confirm({ title: `Apply ${c.counts.APPROVED} approved increase${c.counts.APPROVED === 1 ? '' : 's'}?`, message: `Each becomes a salary revision effective ${formatDate(c.effectiveFrom)} on the employee's current salary structure. Guidelines can't change afterwards.`, confirmLabel: 'Apply increases' }))) return;
  busy.value = true;
  try {
    const result = await performanceApi.applyHikes(id.value);
    failed.value = result.failed;
    feedback.success(`${result.applied} increase${result.applied === 1 ? '' : 's'} applied`, result.failed.length ? `${result.failed.length} could not be applied — see the list on the page.` : undefined);
    await load();
  } catch (e) {
    feedback.error('Could not apply the increases', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="loading && !list" :lines="8" />
    <AppErrorState v-else-if="error && !list" :error="error" title="Could not load the increases" @retry="load" />
    <template v-else-if="list">
      <AppPageHeader
        title="Salary increases"
        :description="`${list.cycle.name}${list.cycle.effectiveFrom ? ` · effective ${formatDate(list.cycle.effectiveFrom)}` : ''}`"
        :back="hr ? `/hr/performance/cycles/${id}` : '/hr/performance/reviews'"
        :back-label="hr ? list.cycle.name : 'Reviews'"
      >
        <template #actions>
          <AppButton v-if="comp?.permissions.configure" variant="secondary" :icon="SlidersHorizontal" @click="openGuidelines">Guidelines</AppButton>
          <AppButton v-if="comp?.permissions.apply" :icon="Wand2" :loading="busy && !modal" @click="apply">Apply approved</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="list.cycle.configured === false" tone="info" class="mb-4" title="Default guidelines">
        Increases are checked against the standard merit guidelines until HR sets this cycle's own{{ comp?.permissions.configure ? ' — use Guidelines' : '' }}.
      </AppAlert>
      <AppAlert v-if="comp && comp.counts.APPROVED && !comp.effectiveFrom" tone="warning" class="mb-4">Set the date the increases take effect (Guidelines) before applying them.</AppAlert>
      <AppAlert v-if="failed.length" tone="warning" class="mb-4" :title="`${failed.length} increase${failed.length === 1 ? ' was' : 's were'} not applied`">
        <ul class="list-disc pl-4">
          <li v-for="f in failed" :key="f.employee">{{ f.employee }}: {{ f.reason }}</li>
        </ul>
      </AppAlert>

      <div v-if="comp" class="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppStatCard label="Awaiting approval" :value="comp.counts.SUBMITTED" :icon="Send" :hint="`${comp.counts.DRAFT} draft${comp.counts.DRAFT === 1 ? '' : 's'}`" />
        <AppStatCard label="Approved" :value="comp.counts.APPROVED + comp.counts.APPLIED" :icon="CheckCircle2" :hint="comp.counts.APPLIED ? `${comp.counts.APPLIED} applied` : 'none applied yet'" />
        <template v-if="comp.budget">
          <AppStatCard label="Average increase" :value="`${comp.budget.averagePercent}%`" :icon="TrendingUp" :hint="`on ${rupees(comp.budget.base)} payroll`" />
          <AppStatCard
            label="Budget left"
            :value="comp.budget.remaining === null ? '—' : rupees(comp.budget.remaining)"
            :icon="PiggyBank"
            :hint="comp.budget.pool === null ? 'No budget set' : `${rupees(comp.budget.approved)} of ${rupees(comp.budget.pool)} approved (${comp.budgetPercent}%)`"
          />
        </template>
      </div>

      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-[240px_240px]">
          <AppSelect v-if="hr" :model-value="view" :options="viewOptions" :clearable="false" aria-label="Whose reviews" @update:model-value="(v: string | null | undefined) => (view = v === 'mine' ? 'mine' : 'all')" />
          <AppSelect v-model="status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable :columns="columns" :rows="rows" :row-key="(r) => r.reviewId" :loading="loading" :error="error" caption="Salary increases" empty-title="No completed reviews" :empty-description="view === 'mine' ? 'Reviews you complete in this cycle appear here.' : 'Completed reviews appear here.'" @retry="load">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-rating="{ row }"><span class="font-medium tabular-nums">{{ row.rating }}</span><span v-if="row.ratingLabel" class="ml-1 text-xs text-fg-muted">{{ row.ratingLabel }}</span></template>
          <template #cell-guideline="{ row }"><span class="text-fg-muted">{{ range(row.guideline) }}</span></template>
          <template #cell-current="{ row }"><span class="tabular-nums">{{ row.currentCtc === null ? 'No salary' : rupees(row.currentCtc) }}</span></template>
          <template #cell-increase="{ row }">
            <template v-if="row.recommendation">
              <p class="font-medium tabular-nums">{{ row.recommendation.percent }}%</p>
              <p v-if="row.recommendation.newCtc" class="text-xs text-fg-muted tabular-nums">→ {{ rupees(row.recommendation.newCtc) }}</p>
              <div class="mt-1 flex flex-wrap justify-end gap-1">
                <AppBadge v-if="row.recommendation.promotion" tone="violet" size="sm">Promotion</AppBadge>
                <AppBadge v-if="row.recommendation.outsideGuideline" tone="warning" size="sm" :title="row.recommendation.justification ?? undefined">Outside guideline</AppBadge>
              </div>
            </template>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-status="{ row }">
            <template v-if="row.recommendation">
              <AppBadge :tone="hikeTone[row.recommendation.status]" dot>{{ HIKE_STATUS_LABELS[row.recommendation.status] }}</AppBadge>
              <p v-if="row.recommendation.decidedBy" class="mt-1 text-xs text-fg-muted">{{ row.recommendation.decidedBy }}{{ row.recommendation.decisionNote ? `: “${row.recommendation.decisionNote}”` : '' }}</p>
              <p v-else-if="row.recommendation.recommendedBy" class="mt-1 text-xs text-fg-muted">by {{ row.recommendation.recommendedBy }}</p>
            </template>
            <span v-else class="text-xs text-fg-muted">Not recommended</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex flex-wrap justify-end gap-2">
              <AppButton v-if="row.permissions.edit" size="sm" variant="secondary" @click="openRecommend(row)">{{ row.recommendation ? 'Edit' : 'Recommend' }}</AppButton>
              <AppButton v-if="row.permissions.edit && row.recommendation && (row.recommendation.status === 'DRAFT' || row.recommendation.status === 'REJECTED')" size="sm" :icon="Send" :disabled="busy" @click="submit(row)">Submit</AppButton>
              <template v-if="row.permissions.decide">
                <AppButton size="sm" variant="secondary" :icon="XCircle" @click="openDecide(row, 'reject')">Reject</AppButton>
                <AppButton size="sm" :icon="CheckCircle2" @click="openDecide(row, 'approve')">Approve</AppButton>
              </template>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <AppModal :open="modal === 'recommend'" :title="`Increase for ${current?.employee.name}`" :description="current ? `Rated ${current.rating}${current.ratingLabel ? ` (${current.ratingLabel})` : ''} · guideline ${range(current.guideline)}` : undefined" @close="modal = null">
        <form id="recommend-hike" class="space-y-4" novalidate @submit.prevent="saveRecommendation(true)">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppInput v-model="recForm.percent" label="Increase" type="number" :min="0" :max="MAX_HIKE_PERCENT" :step="0.5" suffix="%" required :error="fieldErrors.percent" />
          <AppCheckbox v-model="recForm.promotion" label="Also a promotion" description="Recorded with the salary revision." />
          <AppTextarea v-model="recForm.justification" :label="recOutside ? 'Why outside the guideline' : 'Justification (optional)'" :required="recOutside" :rows="3" :maxlength="2000" :error="fieldErrors.justification" />
          <p v-if="preview(current, recForm.percent)" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">
            {{ rupees(current!.currentCtc!) }} → <span class="font-semibold tabular-nums">{{ rupees(preview(current, recForm.percent)) }}</span> a year
          </p>
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton variant="secondary" :loading="busy" :disabled="recForm.percent === ''" @click="saveRecommendation(false)">Save draft</AppButton>
          <AppButton type="submit" form="recommend-hike" :loading="busy" :disabled="recForm.percent === '' || (recOutside && recForm.justification.trim().length < 3)">Submit</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'approve'" :title="`Approve the increase for ${current?.employee.name}`" :description="current?.recommendation?.justification ? `Reviewer's reason: “${current.recommendation.justification}”` : `Guideline ${current ? range(current.guideline) : ''}`" size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppInput v-model="decideForm.percent" label="Approved increase" type="number" :min="0" :max="MAX_HIKE_PERCENT" :step="0.5" suffix="%" :help="`Recommended ${current?.recommendation?.percent}%`" :error="fieldErrors.percent" />
          <AppTextarea v-model="decideForm.note" label="Note (optional)" :rows="2" :maxlength="1000" :error="fieldErrors.note" />
          <p v-if="preview(current, decideForm.percent)" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">New CTC <span class="font-semibold tabular-nums">{{ rupees(preview(current, decideForm.percent)) }}</span></p>
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="decideForm.percent === ''" @click="decide(true)">Approve</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'reject'" :title="`Send back the increase for ${current?.employee.name}?`" description="The reviewer can revise and resubmit it." size="sm" @close="modal = null">
        <AppAlert v-if="formError" class="mb-4">{{ formError }}</AppAlert>
        <AppTextarea v-model="decideForm.note" label="Reason (shared with the reviewer)" required :rows="3" :maxlength="1000" :error="fieldErrors.note" />
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton variant="danger" :loading="busy" :disabled="decideForm.note.trim().length < 3" @click="decide(false)">Reject</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'guidelines'" title="Merit guidelines" description="The increase range for each final rating. Reviewers need a reason to go outside it." size="lg" @close="modal = null">
        <form id="hike-guidelines" class="space-y-5" novalidate @submit.prevent="saveGuidelines">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <p v-if="fieldErrors.meritMatrix" class="text-sm text-danger-600">{{ fieldErrors.meritMatrix }}</p>
          <!-- A row per rating from tablet width up; on phones each rating stacks its label above three labelled fields. -->
          <div class="space-y-4 text-sm sm:space-y-2">
            <div class="hidden grid-cols-[minmax(0,1fr)_repeat(3,7.5rem)] gap-2 text-xs font-medium text-fg-muted sm:grid" aria-hidden="true">
              <span>Rating</span><span>Minimum %</span><span>Target %</span><span>Maximum %</span>
            </div>
            <div v-for="g in guideForm.matrix" :key="g.rating" role="group" :aria-label="`Rating ${g.rating}`" class="grid grid-cols-3 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,7.5rem)] sm:items-center">
              <p class="col-span-3 text-fg sm:col-span-1">{{ g.rating }}<span class="ml-1 text-xs text-fg-muted">{{ comp?.cycle.ratingLabels[g.rating - 1] }}</span></p>
              <div v-for="f in GUIDE_FIELDS" :key="f.key" class="min-w-0">
                <span class="mb-1 block text-xs text-fg-muted sm:hidden" aria-hidden="true">{{ f.label }}</span>
                <AppInput v-model="g[f.key]" :aria-label="`${f.label} for rating ${g.rating}`" type="number" :min="0" :max="MAX_HIKE_PERCENT" :step="0.5" />
              </div>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="guideForm.budgetPercent" label="Budget" type="number" :min="0" :max="MAX_HIKE_PERCENT" :step="0.5" suffix="% of payroll" help="Optional; tracked, not enforced" :error="fieldErrors.budgetPercent" />
            <AppDatePicker v-model="guideForm.effectiveFrom" label="Increases take effect" :error="fieldErrors.effectiveFrom" help="Needed before applying" />
          </div>
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton type="submit" form="hike-guidelines" :loading="busy">Save guidelines</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
