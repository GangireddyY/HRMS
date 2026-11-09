<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BadgeCheck, CheckCircle2, FilterX, Gavel, PiggyBank, Send, SlidersHorizontal, TrendingUp, Wand2, XCircle } from '@lucide/vue';
import { MAX_HIKE_PERCENT, type HikeStatus, type MeritGuideline } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import type { Compensation, HikeList, HikeRow } from '@/modules/performance/types';
import { HIKE_STATUS_LABELS, hikeTone } from '@/modules/performance/utils/performance-format';
import { RATING_FILL, pct, plural } from '@/modules/performance/utils/performance-ops';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDataTable, AppDatePicker, AppErrorState, AppInput, AppModal, AppPageHeader, AppSegmented, AppSkeleton, AppStatStrip, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
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
/** The last list loaded without a status filter: status counts for viewers without the compensation summary. */
const unfiltered = ref<HikeRow[] | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [rows, settings] = await Promise.all([performanceApi.hikes(id.value, { view: view.value, status: status.value }), hr.value ? performanceApi.compensation(id.value) : Promise.resolve(null)]);
    list.value = rows;
    comp.value = settings;
    if (!status.value) unfiltered.value = rows.rows;
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
void load();
watch([id, view, status], () => void load());

const viewOptions = [
  { value: 'all' as const, label: 'Everyone in the cycle' },
  { value: 'mine' as const, label: 'People I reviewed' },
];
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

// ---- Summary ---------------------------------------------------------------------------------------------------
const counts = computed<Record<HikeStatus, number>>(() => {
  if (comp.value) return comp.value.counts;
  const c = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, APPLIED: 0 } as Record<HikeStatus, number>;
  for (const r of unfiltered.value ?? []) if (r.recommendation) c[r.recommendation.status]++;
  return c;
});
const toDecide = computed(() => (unfiltered.value ?? rows.value).filter((r) => r.permissions.decide));
const notRecommended = computed(() => (unfiltered.value ?? []).filter((r) => !r.recommendation).length);
const strip = computed<StripItem[]>(() => {
  const c = counts.value;
  return [
    { key: 'SUBMITTED', label: 'Awaiting approval', value: c.SUBMITTED, tone: 'warning', hint: toDecide.value.length ? `${toDecide.value.length} for you to decide` : c.SUBMITTED ? 'With HR' : 'Nothing waiting' },
    { key: 'DRAFT', label: 'Drafts', value: c.DRAFT, tone: 'neutral', hint: notRecommended.value ? `${plural(notRecommended.value, 'review')} not recommended yet` : c.DRAFT ? 'Not submitted yet' : 'None' },
    { key: 'APPROVED', label: 'Approved', value: c.APPROVED, tone: 'success', hint: c.APPROVED ? 'Ready to apply' : 'None' },
    { key: 'REJECTED', label: 'Sent back', value: c.REJECTED, tone: 'danger', hint: c.REJECTED ? 'Reviewer to revise' : 'None' },
    { key: 'APPLIED', label: 'Applied', value: c.APPLIED, tone: 'brand', hint: c.APPLIED ? 'Salary revised' : 'None yet' },
  ];
});

/** Budget bar: approved, then recommended but not approved yet, against the pool (or the total if over it). */
const budgetBar = computed(() => {
  const b = comp.value?.budget;
  if (!b) return null;
  const scale = Math.max(b.pool ?? 0, b.recommended, 1);
  const pending = Math.max(0, b.recommended - b.approved);
  return {
    approved: (b.approved / scale) * 100,
    pending: (pending / scale) * 100,
    pendingAmount: pending,
    poolAt: b.pool === null ? null : (b.pool / scale) * 100,
    used: b.pool ? pct(b.approved, b.pool) : null,
    over: b.pool !== null && b.recommended > b.pool,
  };
});
/** Increase amounts by status, from the rows on screen (amounts only exist where the viewer can see salaries). */
const spend = computed(() => {
  const by = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, APPLIED: 0 } as Record<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'APPLIED', number>;
  for (const r of unfiltered.value ?? []) {
    const rec = r.recommendation;
    if (rec && rec.status !== 'REJECTED' && rec.newCtc && r.currentCtc) by[rec.status] += rec.newCtc - r.currentCtc;
  }
  return (['DRAFT', 'SUBMITTED', 'APPROVED', 'APPLIED'] as const).map((s) => ({ key: s, label: HIKE_STATUS_LABELS[s], amount: by[s], tone: hikeTone[s] }));
});
const STEPS = [
  'Reviewers recommend and submit an increase for each completed review.',
  'HR with salary-revision rights approves, adjusts or sends it back.',
  'HR applies the approved increases as salary revisions.',
];

/** Merit matrix rows (highest rating first) with how many people in the list have that rating. */
const matrix = computed(() => {
  const source = comp.value?.meritMatrix ?? [...new Map(rows.value.map((r) => [r.rating, r.guideline])).values()];
  const people = unfiltered.value ?? rows.value;
  return [...source].sort((a, b) => b.rating - a.rating).map((g) => ({ ...g, people: people.filter((r) => r.rating === g.rating).length }));
});
const ratingLabels = computed(() => comp.value?.cycle.ratingLabels ?? []);
const labelOf = (rating: number) => ratingLabels.value[rating - 1] || (unfiltered.value ?? rows.value).find((r) => r.rating === rating)?.ratingLabel || `Rating ${rating}`;
function labelFor(row: HikeRow) {
  const labels = [...ratingLabels.value];
  if (row.ratingLabel) labels[row.rating - 1] = row.ratingLabel;
  return labels;
}
/** Shared horizontal scale for the guideline bars so ranges compare across rows. */
const scale = computed(() => Math.max(1, ...matrix.value.map((g) => g.max), ...rows.value.map((r) => Math.max(r.guideline.max, r.recommendation?.percent ?? 0))) * 1.1);
const at = (p: number) => `${Math.min(100, (p / scale.value) * 100)}%`;

const { fieldErrors, formError, handle, reset } = useFormErrors();
const busy = ref(false);
const modal = ref<'recommend' | 'approve' | 'reject' | 'guidelines' | null>(null);
const current = ref<HikeRow | null>(null);

function replace(row: HikeRow | null) {
  if (!row || !list.value) return;
  list.value = { ...list.value, rows: list.value.rows.map((r) => (r.reviewId === row.reviewId ? row : r)) };
  if (unfiltered.value) unfiltered.value = unfiltered.value.map((r) => (r.reviewId === row.reviewId ? row : r));
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

      <div class="space-y-4">
        <AppAlert v-if="list.cycle.configured === false" tone="info" title="Default guidelines">
          Increases are checked against the standard merit guidelines until HR sets this cycle's own{{ comp?.permissions.configure ? ' — use Guidelines' : '' }}.
        </AppAlert>
        <AppAlert v-if="comp && comp.counts.APPROVED && !comp.effectiveFrom" tone="warning">Set the date the increases take effect (Guidelines) before applying them.</AppAlert>
        <AppAlert v-if="failed.length" tone="warning" :title="`${failed.length} increase${failed.length === 1 ? ' was' : 's were'} not applied`">
          <ul class="list-disc ps-4">
            <li v-for="f in failed" :key="f.employee">{{ f.employee }}: {{ f.reason }}</li>
          </ul>
        </AppAlert>

        <AppStatStrip :items="strip" selectable :selected="status ?? null" label="Recommendations by status" @select="(k) => (status = (k as HikeStatus | null) ?? undefined)" />

        <div class="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <!-- Budget -->
        <section v-if="comp?.budget && budgetBar" class="card flex flex-col overflow-hidden" aria-labelledby="budget-title">
          <div class="flex-1 p-4 sm:p-5">
            <div>
              <p id="budget-title" class="flex items-center gap-2 text-xs font-semibold tracking-wide text-accent-fg uppercase"><PiggyBank :size="14" aria-hidden="true" />Increase budget</p>
              <p class="mt-1.5 text-sm text-fg-muted">
                <span class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(comp.budget.approved) }}</span>
                approved<template v-if="comp.budget.pool !== null"> of <span class="font-medium text-fg tabular-nums">{{ rupees(comp.budget.pool) }}</span> ({{ comp.budgetPercent }}% of payroll)</template>
              </p>
              <div class="relative mt-3">
                <div class="flex h-3 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Approved ${rupees(comp.budget.approved)}, pending ${rupees(budgetBar.pendingAmount)}${comp.budget.pool !== null ? ` of ${rupees(comp.budget.pool)}` : ''}`">
                  <span class="h-full bg-brand-500 transition-[width] duration-500" :style="{ width: `${budgetBar.approved}%` }" />
                  <span :class="['h-full transition-[width] duration-500', budgetBar.over ? 'bg-danger/50' : 'bg-brand-500/35']" :style="{ width: `${budgetBar.pending}%` }" />
                </div>
                <span v-if="budgetBar.poolAt !== null && budgetBar.over" class="absolute -inset-y-1 w-0.5 rounded-full bg-fg" :style="{ insetInlineStart: `${budgetBar.poolAt}%` }" :title="`Budget ${rupees(comp.budget.pool)}`" aria-hidden="true" />
              </div>
              <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                <li class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />Approved or applied</li>
                <li class="flex items-center gap-1.5"><span :class="['h-2 w-2 rounded-full', budgetBar.over ? 'bg-danger/60' : 'bg-brand-500/35']" aria-hidden="true" />Recommended, not approved yet · {{ rupees(budgetBar.pendingAmount) }}</li>
                <li v-if="budgetBar.over" class="flex items-center gap-1.5 font-medium text-danger-fg"><span class="h-3 w-0.5 rounded-full bg-fg" aria-hidden="true" />Recommendations exceed the budget by {{ rupees(comp.budget.recommended - (comp.budget.pool ?? 0)) }}</li>
              </ul>
            </div>
            <ul v-if="spend.some((s) => s.amount)" class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Increase amounts by status">
              <li v-for="s in spend" :key="s.key" class="rounded-lg bg-surface-muted/50 px-3 py-2 ring-1 ring-line/70 ring-inset">
                <p class="text-2xs text-fg-muted">{{ s.label }}</p>
                <p :class="['text-sm font-semibold tabular-nums', s.amount ? 'text-fg' : 'text-fg-subtle']">{{ rupees(s.amount) }}</p>
              </li>
            </ul>
          </div>
          <dl class="grid grid-cols-3 divide-x divide-line/70 border-t border-line/70 bg-surface-muted/30 text-sm rtl:divide-x-reverse">
            <div class="px-4 py-3 sm:px-5">
              <dt class="text-xs text-fg-muted">Budget left</dt>
              <dd :class="['text-lg font-semibold tabular-nums', comp.budget.remaining !== null && comp.budget.remaining < 0 ? 'text-danger-fg' : 'text-fg']">{{ comp.budget.remaining === null ? '—' : rupees(comp.budget.remaining) }}</dd>
              <dd class="text-2xs text-fg-subtle">{{ comp.budget.pool === null ? 'No budget set' : `${budgetBar.used}% used` }}</dd>
            </div>
            <div class="px-4 py-3 sm:px-5">
              <dt class="text-xs text-fg-muted">Average increase</dt>
              <dd :class="['text-lg font-semibold tabular-nums', comp.budgetPercent !== null && comp.budget.averagePercent > comp.budgetPercent ? 'text-danger-fg' : 'text-fg']">{{ comp.budget.averagePercent }}%</dd>
              <dd class="text-2xs text-fg-subtle">{{ comp.budgetPercent !== null ? `against a ${comp.budgetPercent}% budget` : 'of recommendations' }}</dd>
            </div>
            <div class="px-4 py-3 sm:px-5">
              <dt class="text-xs text-fg-muted">Payroll base</dt>
              <dd class="text-lg font-semibold text-fg tabular-nums">{{ rupees(comp.budget.base) }}</dd>
              <dd class="text-2xs text-fg-subtle">CTC of people recommended</dd>
            </div>
          </dl>
        </section>
        <AppCard v-else title="How increases work" :icon="Wand2" fill>
          <ol class="space-y-3 text-sm">
            <li v-for="(s, i) in STEPS" :key="s" class="flex gap-2.5">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xs font-semibold text-fg-muted tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
              <span class="text-fg-muted">{{ s }}</span>
            </li>
          </ol>
          <p v-if="list.cycle.effectiveFrom" class="mt-4 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Approved increases take effect <span class="font-medium text-fg">{{ formatDate(list.cycle.effectiveFrom) }}</span>.</p>
        </AppCard>

        <AppCard title="Merit matrix" :icon="BadgeCheck" :description="list.cycle.configured === false ? 'Standard guidelines' : 'Increase range per final rating'" fill>
          <template v-if="comp?.permissions.configure" #actions><AppButton size="xs" variant="ghost" :icon="SlidersHorizontal" @click="openGuidelines">Edit</AppButton></template>
          <p v-if="!matrix.length" class="text-sm text-fg-muted">Guidelines appear once reviews are completed.</p>
          <ol v-else class="space-y-2.5">
            <li v-for="g in matrix" :key="g.rating" class="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-center gap-x-2.5">
              <span :class="['flex h-5 w-5 items-center justify-center rounded text-2xs font-semibold text-white tabular-nums', RATING_FILL[g.rating]]" aria-hidden="true">{{ g.rating }}</span>
              <div class="min-w-0">
                <p class="mb-1 flex justify-between gap-2 text-xs">
                  <span class="truncate text-fg">{{ labelOf(g.rating) }}</span>
                  <span v-if="g.people" class="shrink-0 text-fg-subtle">{{ plural(g.people, 'person', 'people') }}</span>
                </p>
                <div class="relative h-1.5 rounded-full bg-surface-muted" role="img" :aria-label="`Rating ${g.rating}: ${range(g)}`">
                  <span v-if="g.max > 0" class="absolute inset-y-0 rounded-full bg-brand-500/30" :style="{ insetInlineStart: at(g.min), width: `calc(${at(g.max)} - ${at(g.min)})` }" />
                  <span v-if="g.max > 0" class="absolute -inset-y-0.5 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" :style="{ insetInlineStart: at(g.target) }" />
                </div>
              </div>
              <span class="text-end text-xs tabular-nums">
                <span class="block font-medium text-fg">{{ g.max === 0 ? 'None' : `${g.min}–${g.max}%` }}</span>
                <span v-if="g.max > 0" class="block text-2xs text-fg-subtle">target {{ g.target }}%</span>
              </span>
            </li>
          </ol>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-2xs text-fg-muted">
            <span class="flex items-center gap-1.5"><span class="h-2 w-4 rounded-full bg-brand-500/30" aria-hidden="true" />Range</span>
            <span class="flex items-center gap-1.5"><span class="h-3 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" />Target</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-fg" aria-hidden="true" />Recommended (in the list)</span>
          </div>
        </AppCard>
        </div>

        <div>
          <div class="space-y-4">
            <!-- Work queue for approvers -->
            <section v-if="toDecide.length && !status" class="card overflow-hidden ring-1 ring-warning/30" aria-labelledby="decide-title">
              <header class="flex items-center gap-3 border-b border-line/70 bg-warning-soft/40 px-4 py-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning-fg" aria-hidden="true"><Gavel :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <h2 id="decide-title" class="text-sm font-semibold text-fg">Waiting for your decision</h2>
                  <p class="text-xs text-fg-muted">Approve as recommended, adjust the percentage, or send it back with a reason.</p>
                </div>
                <span class="rounded-full bg-warning px-2 py-0.5 text-2xs font-semibold text-white tabular-nums">{{ toDecide.length }}</span>
              </header>
              <ul class="divide-y divide-line/60">
                <li v-for="row in toDecide" :key="row.reviewId" class="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AppAvatar :name="row.employee.name" size="md" />
                  <div class="min-w-0 flex-1 basis-48">
                    <p class="truncate text-sm font-semibold text-fg">{{ row.employee.name }}</p>
                    <p class="truncate text-xs text-fg-muted">
                      Rated {{ row.rating }}{{ row.ratingLabel ? ` · ${row.ratingLabel}` : '' }}<template v-if="row.recommendation?.recommendedBy"> · by {{ row.recommendation.recommendedBy }}</template>
                    </p>
                  </div>
                  <div class="text-end">
                    <p class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ row.recommendation!.percent }}%</p>
                    <p v-if="row.recommendation!.newCtc && row.currentCtc" class="text-2xs text-fg-muted tabular-nums">{{ rupees(row.currentCtc) }} → {{ rupees(row.recommendation!.newCtc) }}</p>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <AppBadge v-if="row.recommendation!.promotion" tone="violet" size="sm">Promotion</AppBadge>
                    <AppBadge v-if="row.recommendation!.outsideGuideline" tone="warning" size="sm" :title="row.recommendation!.justification ?? undefined">Outside guideline</AppBadge>
                  </div>
                  <div class="flex gap-2">
                    <AppButton size="sm" variant="secondary" :icon="XCircle" @click="openDecide(row, 'reject')">Reject</AppButton>
                    <AppButton size="sm" :icon="CheckCircle2" @click="openDecide(row, 'approve')">Approve</AppButton>
                  </div>
                </li>
              </ul>
            </section>

            <section class="card overflow-hidden" aria-labelledby="hikes-title">
              <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
                <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><TrendingUp :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <h2 id="hikes-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
                    {{ status ? HIKE_STATUS_LABELS[status] : 'Recommendations' }}
                    <AppBadge size="sm">{{ rows.length }}</AppBadge>
                  </h2>
                  <p class="text-xs text-fg-muted">Completed reviews in this cycle{{ status ? ' · filtered by status' : '' }}</p>
                </div>
                <AppButton v-if="status" size="sm" variant="ghost" :icon="FilterX" @click="status = undefined">All statuses</AppButton>
                <AppSegmented v-if="hr" v-model="view" class="sm:w-80" size="sm" :options="viewOptions" label="Whose reviews" />
              </header>
              <AppDataTable :columns="columns" :rows="rows" :row-key="(r) => r.reviewId" :loading="loading" :error="error" caption="Salary increases" empty-title="No completed reviews" :empty-description="view === 'mine' ? 'Reviews you complete in this cycle appear here.' : 'Completed reviews appear here.'" :filtered="!!status" @clear="status = undefined" @retry="load">
                <template #cell-employee="{ row }">
                  <div class="flex items-center gap-3">
                    <AppAvatar :name="row.employee.name" size="sm" />
                    <div class="min-w-0">
                      <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                      <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
                    </div>
                  </div>
                </template>
                <template #cell-rating="{ row }"><RatingChip :rating="row.rating" :labels="labelFor(row)" /></template>
                <template #cell-guideline="{ row }">
                  <div class="w-40 max-md:ms-auto">
                    <div class="relative h-2 rounded-full bg-surface-muted" role="img" :aria-label="`Guideline ${range(row.guideline)}${row.recommendation ? `; recommended ${row.recommendation.percent}%` : ''}`">
                      <span v-if="row.guideline.max > 0" class="absolute inset-y-0 rounded-full bg-brand-500/25" :style="{ insetInlineStart: at(row.guideline.min), width: `calc(${at(row.guideline.max)} - ${at(row.guideline.min)})` }" />
                      <span v-if="row.guideline.max > 0" class="absolute -inset-y-0.5 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" :style="{ insetInlineStart: at(row.guideline.target) }" />
                      <span v-if="row.recommendation" :class="['absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface rtl:translate-x-1/2', row.recommendation.outsideGuideline ? 'bg-warning' : 'bg-fg']" :style="{ insetInlineStart: at(row.recommendation.percent) }" />
                    </div>
                    <p class="mt-1 text-2xs text-fg-muted tabular-nums">{{ range(row.guideline) }}</p>
                  </div>
                </template>
                <template #cell-current="{ row }"><span class="text-fg-muted tabular-nums">{{ row.currentCtc === null ? 'No salary' : rupees(row.currentCtc) }}</span></template>
                <template #cell-increase="{ row }">
                  <template v-if="row.recommendation">
                    <p class="font-semibold text-fg tabular-nums">+{{ row.recommendation.percent }}%</p>
                    <p v-if="row.recommendation.newCtc" class="text-xs whitespace-nowrap text-fg-muted tabular-nums">→ {{ rupees(row.recommendation.newCtc) }}</p>
                    <div v-if="row.recommendation.promotion || row.recommendation.outsideGuideline" class="mt-1 flex flex-wrap justify-end gap-1">
                      <AppBadge v-if="row.recommendation.promotion" tone="violet" size="sm">Promotion</AppBadge>
                      <AppBadge v-if="row.recommendation.outsideGuideline" tone="warning" size="sm" :title="row.recommendation.justification ?? undefined">Outside guideline</AppBadge>
                    </div>
                  </template>
                  <span v-else class="text-fg-subtle">—</span>
                </template>
                <template #cell-status="{ row }">
                  <template v-if="row.recommendation">
                    <AppBadge :tone="hikeTone[row.recommendation.status]" dot>{{ HIKE_STATUS_LABELS[row.recommendation.status] }}</AppBadge>
                    <p v-if="row.recommendation.decidedBy" class="mt-1 max-w-56 truncate text-xs text-fg-muted" :title="row.recommendation.decisionNote ?? undefined">{{ row.recommendation.decidedBy }}{{ row.recommendation.decisionNote ? `: “${row.recommendation.decisionNote}”` : '' }}</p>
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
            </section>
          </div>

        </div>
      </div>

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
              <p class="col-span-3 flex items-center gap-2 text-fg sm:col-span-1">
                <span :class="['flex h-5 w-5 shrink-0 items-center justify-center rounded text-2xs font-semibold text-white tabular-nums', RATING_FILL[g.rating]]" aria-hidden="true">{{ g.rating }}</span>
                <span class="sr-only">{{ g.rating }}</span><span class="text-xs text-fg-muted">{{ comp?.cycle.ratingLabels[g.rating - 1] }}</span>
              </p>
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
