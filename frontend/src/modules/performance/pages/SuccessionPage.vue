<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { GitBranchPlus, Pencil, Plus, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2, UserPlus, Users } from '@lucide/vue';
import { SUCCESSION_LEVEL_LABELS, SUCCESSION_LEVELS, SUCCESSOR_READINESS, SUCCESSOR_READINESS_LABELS, type BenchStrength, type SuccessionLevel, type SuccessionPlanView, type SuccessorReadiness } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { employeesApi } from '@/modules/people/api/people.api';
import { performanceApi } from '@/modules/performance/api/performance.api';
import { AppAlert, AppBadge, AppButton, AppDatePicker, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppStatStrip, AppTextarea, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Critical roles and who could step in: bench strength, readiness and 9-box placement of each successor. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const data = useAsync(() => performanceApi.succession());
const plans = computed(() => data.data.value?.plans ?? []);
const canManage = computed(() => auth.can('performance.succession.manage'));
const filter = ref<BenchStrength | null>(null);
const shown = computed(() => (filter.value ? plans.value.filter((p) => p.bench === filter.value) : plans.value));

const BENCH: Record<BenchStrength, { label: string; tone: 'success' | 'warning' | 'danger'; icon: typeof ShieldCheck }> = {
  COVERED: { label: 'Ready successor', tone: 'success', icon: ShieldCheck },
  AT_RISK: { label: 'No one ready now', tone: 'warning', icon: ShieldQuestion },
  NONE: { label: 'No successors', tone: 'danger', icon: ShieldAlert },
};
const LEVEL_TONE: Record<SuccessionLevel, 'danger' | 'warning' | 'neutral'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };
const strip = computed<StripItem[]>(() => {
  const s = data.data.value?.summary;
  if (!s) return [];
  return [
    { key: 'COVERED', label: 'Covered', value: s.COVERED, tone: 'success', hint: 'Someone is ready now' },
    { key: 'AT_RISK', label: 'At risk', value: s.AT_RISK, tone: 'warning', hint: 'Successors, none ready now' },
    { key: 'NONE', label: 'No bench', value: s.NONE, tone: 'danger', hint: s.highRisk ? `${s.highRisk} highly critical role${s.highRisk === 1 ? '' : 's'} not covered` : 'Nobody named' },
  ];
});
const nineBox = (n: SuccessionPlanView['successors'][number]['nineBox']) => (n.rating === null ? 'Not reviewed' : `Rating ${n.rating}${n.potential ? ` · potential ${['low', 'medium', 'high'][n.potential - 1]}` : ''}`);

// Employee picker (holders and successors).
const people = ref<{ value: string; label: string; description?: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      people.value = (await employeesApi.list({ status: 'ACTIVE', search: q || undefined, pageSize: 20 })).items.map((e) => ({ value: e.id, label: e.fullName, description: [e.employeeCode, e.designation?.name].filter(Boolean).join(' · ') }));
    } catch {
      people.value = [];
    }
  }, 250);
}

const LEVELS = SUCCESSION_LEVELS.map((l) => ({ value: l, label: SUCCESSION_LEVEL_LABELS[l] }));
const READINESS = SUCCESSOR_READINESS.map((r) => ({ value: r, label: SUCCESSOR_READINESS_LABELS[r] }));

// Plan editor.
const planModal = ref(false);
const editing = ref<SuccessionPlanView | null>(null);
const planForm = reactive({ title: '', incumbentEmployeeId: null as string | null, criticality: 'HIGH' as SuccessionLevel, riskOfLoss: 'MEDIUM' as SuccessionLevel, reviewBy: undefined as string | undefined, notes: '' });
function openPlan(p: SuccessionPlanView | null) {
  reset();
  editing.value = p;
  Object.assign(planForm, { title: p?.title ?? '', incumbentEmployeeId: p?.incumbent?.id ?? null, criticality: p?.criticality ?? 'HIGH', riskOfLoss: p?.riskOfLoss ?? 'MEDIUM', reviewBy: p?.reviewBy ?? undefined, notes: p?.notes ?? '' });
  people.value = p?.incumbent ? [{ value: p.incumbent.id, label: p.incumbent.name }] : [];
  search('');
  planModal.value = true;
}
const busy = ref(false);
async function savePlan() {
  reset();
  busy.value = true;
  try {
    await performanceApi.saveSuccessionPlan({ title: planForm.title, incumbentEmployeeId: planForm.incumbentEmployeeId, departmentId: null, criticality: planForm.criticality, riskOfLoss: planForm.riskOfLoss, notes: planForm.notes || null, reviewBy: planForm.reviewBy ?? null }, editing.value?.id);
    planModal.value = false;
    feedback.success(editing.value ? 'Plan updated' : 'Plan created');
    await data.run();
  } catch (e) {
    handle(e, 'Could not save the plan');
  } finally {
    busy.value = false;
  }
}
async function removePlan(p: SuccessionPlanView) {
  if (!(await feedback.confirm({ title: `Delete the plan for "${p.title}"?`, message: 'Its successors and notes are removed.', confirmLabel: 'Delete', danger: true }))) return;
  await performanceApi.removeSuccessionPlan(p.id);
  await data.run();
}

// Successors.
const successorModal = ref<SuccessionPlanView | null>(null);
const successorForm = reactive({ employeeId: null as string | null, readiness: 'ONE_TO_TWO_YEARS' as SuccessorReadiness, developmentNotes: '' });
function openSuccessor(p: SuccessionPlanView) {
  reset();
  Object.assign(successorForm, { employeeId: null, readiness: 'ONE_TO_TWO_YEARS', developmentNotes: '' });
  search('');
  successorModal.value = p;
}
async function addSuccessor() {
  if (!successorModal.value || !successorForm.employeeId) return;
  reset();
  busy.value = true;
  try {
    await performanceApi.addSuccessor(successorModal.value.id, { employeeId: successorForm.employeeId, readiness: successorForm.readiness, developmentNotes: successorForm.developmentNotes || null });
    successorModal.value = null;
    feedback.success('Successor added');
    await data.run();
  } catch (e) {
    handle(e, 'Could not add the successor');
  } finally {
    busy.value = false;
  }
}
async function setReadiness(p: SuccessionPlanView, id: string, readiness: SuccessorReadiness) {
  try {
    await performanceApi.updateSuccessor(p.id, id, { readiness });
    await data.run();
  } catch (e) {
    feedback.error('Could not update readiness', e);
  }
}
async function removeSuccessor(p: SuccessionPlanView, id: string, name: string) {
  if (!(await feedback.confirm({ title: `Remove ${name} from the bench?`, message: 'Their readiness and development notes for this role are removed.', confirmLabel: 'Remove' }))) return;
  await performanceApi.removeSuccessor(p.id, id);
  await data.run();
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Succession planning" description="Critical roles, the risk of losing the people in them, and who could step in.">
      <template v-if="canManage" #actions>
        <AppButton :icon="Plus" @click="openPlan(null)">New plan</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="data.loading.value && !data.data.value" :lines="6" />
    <AppErrorState v-else-if="data.error.value" :error="data.error.value" @retry="data.run" />
    <template v-else>
      <AppStatStrip v-if="plans.length" :items="strip" selectable :selected="filter" label="Plans by bench strength" @select="(k) => (filter = (k as BenchStrength | null) ?? null)" />
      <AppEmptyState v-if="!plans.length" :icon="GitBranchPlus" title="No succession plans yet" description="Start with the roles the organization can least afford to leave empty." />
      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="p in shown" :key="p.id" class="card flex flex-col overflow-hidden">
          <header class="flex items-start gap-3 border-b border-line/70 px-4 py-3">
            <component :is="BENCH[p.bench].icon" :size="20" :class="['mt-0.5 shrink-0', p.bench === 'COVERED' ? 'text-success-fg' : p.bench === 'AT_RISK' ? 'text-warning-fg' : 'text-danger-fg']" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 class="truncate font-semibold text-fg">{{ p.title }}</h2>
              <p class="truncate text-xs text-fg-muted">{{ p.incumbent ? `${p.incumbent.name}${p.incumbent.designation ? ` · ${p.incumbent.designation}` : ''}` : 'Vacant' }}<template v-if="p.department"> · {{ p.department.name }}</template></p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <AppBadge size="sm" :tone="BENCH[p.bench].tone" dot>{{ BENCH[p.bench].label }}</AppBadge>
                <AppBadge size="sm" :tone="LEVEL_TONE[p.criticality]">{{ SUCCESSION_LEVEL_LABELS[p.criticality] }} criticality</AppBadge>
                <AppBadge size="sm" :tone="LEVEL_TONE[p.riskOfLoss]">{{ SUCCESSION_LEVEL_LABELS[p.riskOfLoss] }} risk of loss</AppBadge>
              </div>
            </div>
            <div v-if="p.canManage" class="flex shrink-0 gap-1">
              <AppButton size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${p.title}`" @click="openPlan(p)" />
              <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${p.title}`" @click="removePlan(p)" />
            </div>
          </header>
          <ol v-if="p.successors.length" class="flex-1 divide-y divide-line/70" :aria-label="`Successors for ${p.title}`">
            <li v-for="s in p.successors" :key="s.id" class="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xs font-semibold text-fg-muted tabular-nums" aria-hidden="true">{{ s.rank }}</span>
              <div class="min-w-0 flex-1 basis-40">
                <p class="truncate text-sm font-medium text-fg">{{ s.employee.name }}</p>
                <p class="truncate text-2xs text-fg-muted">{{ [s.employee.designation, s.employee.department].filter(Boolean).join(' · ') }} · {{ nineBox(s.nineBox) }}</p>
                <p v-if="s.developmentNotes" class="mt-0.5 line-clamp-2 text-2xs text-fg-subtle">{{ s.developmentNotes }}</p>
              </div>
              <AppSelect v-if="p.canManage" :model-value="s.readiness" :options="READINESS" size="sm" :aria-label="`Readiness of ${s.employee.name}`" class="w-44" @update:model-value="(v) => v && setReadiness(p, s.id, v as SuccessorReadiness)" />
              <AppBadge v-else size="sm" :tone="s.readiness === 'READY_NOW' ? 'success' : 'neutral'">{{ SUCCESSOR_READINESS_LABELS[s.readiness] }}</AppBadge>
              <AppButton v-if="p.canManage" size="xs" variant="ghost" :icon="Trash2" :aria-label="`Remove ${s.employee.name}`" @click="removeSuccessor(p, s.id, s.employee.name)" />
            </li>
          </ol>
          <p v-else class="flex flex-1 items-center gap-2 px-4 py-4 text-sm text-fg-muted"><Users :size="16" aria-hidden="true" />Nobody named yet.</p>
          <footer class="flex items-center justify-between gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-2 text-2xs text-fg-muted">
            <span>{{ p.reviewBy ? `Review by ${formatDate(p.reviewBy)}` : `Updated ${formatDate(p.updatedAt)}` }}</span>
            <AppButton v-if="p.canManage" size="xs" variant="ghost" :icon="UserPlus" @click="openSuccessor(p)">Add successor</AppButton>
          </footer>
        </article>
      </div>
    </template>

    <AppModal :open="planModal" :title="editing ? 'Edit succession plan' : 'New succession plan'" size="md" @close="planModal = false">
      <form id="plan-form" class="space-y-4" novalidate @submit.prevent="savePlan">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="planForm.title" label="Role" required placeholder="e.g. Head of engineering" :error="fieldErrors.title" />
        <AppSelect v-model="planForm.incumbentEmployeeId" label="Current holder" placeholder="Vacant" :options="people" searchable remote clearable :error="fieldErrors.incumbentEmployeeId" @search="search" />
        <div class="grid gap-3 sm:grid-cols-2">
          <AppSelect v-model="planForm.criticality" label="How critical the role is" :options="LEVELS" />
          <AppSelect v-model="planForm.riskOfLoss" label="Risk of losing the holder" :options="LEVELS" />
        </div>
        <AppDatePicker v-model="planForm.reviewBy" label="Review the plan by" />
        <AppTextarea v-model="planForm.notes" label="Notes" :rows="3" :maxlength="2000" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="planModal = false">Cancel</AppButton>
        <AppButton form="plan-form" type="submit" :loading="busy" :disabled="planForm.title.trim().length < 2">{{ editing ? 'Save' : 'Create plan' }}</AppButton>
      </template>
    </AppModal>

    <AppModal :open="!!successorModal" :title="successorModal ? `Successor for ${successorModal.title}` : ''" size="sm" @close="successorModal = null">
      <form id="successor-form" class="space-y-4" novalidate @submit.prevent="addSuccessor">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppSelect v-model="successorForm.employeeId" label="Employee" required :options="people" searchable remote :error="fieldErrors.employeeId" @search="search" />
        <AppSelect v-model="successorForm.readiness" label="Readiness" :options="READINESS" />
        <AppTextarea v-model="successorForm.developmentNotes" label="Development plan" :rows="3" :maxlength="2000" placeholder="What they need to be ready" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="successorModal = null">Cancel</AppButton>
        <AppButton form="successor-form" type="submit" :loading="busy" :disabled="!successorForm.employeeId">Add</AppButton>
      </template>
    </AppModal>
  </div>
</template>
