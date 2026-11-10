<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Building2, Plus, Trash2, User, Users } from '@lucide/vue';
import { OKR_MAX_KEY_RESULTS, OKR_METRICS, type OkrLevel, type OkrMetric } from '@contracts';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { ObjectiveDetail, OkrList } from '@/modules/performance/types';
import { OKR_LEVEL_LABELS, OKR_METRIC_LABELS } from '@/modules/performance/utils/performance-format';
import { quarterOf } from '@/modules/performance/utils/performance-ops';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSegmented, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Set (or edit) an objective: level, whose it is, the period, what it supports and, when new, its key results. */
const props = defineProps<{ open: boolean; can: OkrList['can']; date: string; objective?: ObjectiveDetail | null; parentId?: string | null }>();
const emit = defineEmits<{ close: []; saved: [o: ObjectiveDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const editing = computed(() => !!props.objective);
type KrRow = { title: string; metric: OkrMetric; startValue: number | string | null; targetValue: number | string | null; unit: string; weight: number | string | null };
const blankKr = (): KrRow => ({ title: '', metric: 'NUMBER', startValue: 0, targetValue: null, unit: '', weight: 1 });
const form = reactive({
  level: 'INDIVIDUAL' as OkrLevel,
  title: '',
  description: '',
  ownerEmployeeId: null as string | null,
  departmentId: null as string | null,
  parentId: null as string | null,
  periodStart: undefined as string | undefined,
  periodEnd: undefined as string | undefined,
  keyResults: [blankKr()] as KrRow[],
});
const saving = ref(false);

const levelOptions = computed(() =>
  (
    [
      { value: 'COMPANY', label: OKR_LEVEL_LABELS.COMPANY, icon: Building2, show: props.can.company },
      { value: 'DEPARTMENT', label: OKR_LEVEL_LABELS.DEPARTMENT, icon: Users, show: props.can.department },
      { value: 'INDIVIDUAL', label: OKR_LEVEL_LABELS.INDIVIDUAL, icon: User, show: props.can.individual },
    ] as const
  )
    .filter((o) => o.show)
    .map(({ value, label, icon }) => ({ value: value as OkrLevel, label, icon })),
);
const metricOptions = OKR_METRICS.map((m) => ({ value: m, label: OKR_METRIC_LABELS[m] }));
const quarters = computed(() => [-1, 0, 1, 2].map((o) => quarterOf(props.date, o)));
const quarterOptions = computed(() => [...quarters.value.map((q) => ({ value: q.start, label: q.label, description: `${q.start} – ${q.end}` })), { value: 'custom', label: 'Custom dates' }]);
const quarter = ref<string | null>(null);
watch(quarter, (q) => {
  const hit = quarters.value.find((x) => x.start === q);
  if (hit) Object.assign(form, { periodStart: hit.start, periodEnd: hit.end });
});

const departments = ref<{ value: string; label: string }[]>([]);
const people = ref<{ value: string; label: string; description?: string }[]>([]);
const parents = ref<{ value: string; label: string; description?: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const page = await employeesApi.list({ status: 'ACTIVE', search: q || undefined, pageSize: 20, sort: 'name:asc' });
      people.value = page.items.map((e) => ({ value: e.id, label: e.fullName, description: [e.employeeCode, e.designation?.name].filter(Boolean).join(' · ') }));
    } catch {
      people.value = [];
    }
  }, 250);
}
async function loadParents() {
  if (!form.periodStart || !form.periodEnd || form.periodEnd < form.periodStart) return;
  try {
    const list = await performanceApi.okrParents(form.level, form.periodStart, form.periodEnd);
    parents.value = list.filter((p) => p.id !== props.objective?.id).map((p) => ({ value: p.id, label: p.title, description: OKR_LEVEL_LABELS[p.level] }));
    if (form.parentId && !parents.value.some((p) => p.value === form.parentId)) form.parentId = null;
  } catch {
    parents.value = [];
  }
}
watch(() => [form.level, form.periodStart, form.periodEnd], () => props.open && void loadParents());

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reset();
    const o = props.objective;
    const current = quarterOf(props.date);
    if (o) {
      Object.assign(form, { level: o.level, title: o.title, description: o.description ?? '', ownerEmployeeId: o.owner?.id ?? null, departmentId: o.department?.id ?? null, parentId: o.parentId, periodStart: o.periodStart, periodEnd: o.periodEnd, keyResults: [] });
      quarter.value = quarters.value.find((q) => q.start === o.periodStart && q.end === o.periodEnd)?.start ?? 'custom';
    } else {
      const level: OkrLevel = props.can.individual ? 'INDIVIDUAL' : props.can.department ? 'DEPARTMENT' : 'COMPANY';
      Object.assign(form, { level, title: '', description: '', ownerEmployeeId: null, departmentId: props.can.departmentId, parentId: props.parentId ?? null, periodStart: current.start, periodEnd: current.end, keyResults: [blankKr()] });
      quarter.value = current.start;
    }
    if (props.can.forOthers) search('');
    if (props.can.department && !props.can.departmentId) {
      try {
        departments.value = (await structureApi.departments()).map((d) => ({ value: d.id, label: d.name }));
      } catch {
        departments.value = [];
      }
    }
    await loadParents();
  },
  { immediate: true },
);

const filled = (v: number | string | null) => v !== null && v !== '' && Number.isFinite(Number(v));
const krValid = (k: KrRow) => k.title.trim().length >= 3 && (k.metric === 'MILESTONE' || (filled(k.targetValue) && Number(k.targetValue) !== Number(k.startValue ?? 0)));
const canSave = computed(
  () =>
    form.title.trim().length >= 3 &&
    !!form.periodStart &&
    !!form.periodEnd &&
    form.periodEnd >= form.periodStart &&
    (form.level !== 'DEPARTMENT' || !!form.departmentId) &&
    (editing.value || form.keyResults.every(krValid)),
);

async function save() {
  reset();
  saving.value = true;
  try {
    const o = props.objective;
    const saved = o
      ? await performanceApi.updateOkr(o.id, { title: form.title, description: form.description || null, parentId: form.parentId, periodStart: form.periodStart, periodEnd: form.periodEnd })
      : await performanceApi.createOkr({
          title: form.title,
          description: form.description || null,
          level: form.level,
          ownerEmployeeId: form.level !== 'DEPARTMENT' || form.ownerEmployeeId ? form.ownerEmployeeId : null,
          departmentId: form.level === 'DEPARTMENT' ? form.departmentId : null,
          parentId: form.parentId,
          periodStart: form.periodStart!,
          periodEnd: form.periodEnd!,
          keyResults: form.keyResults.map((k) => ({
            title: k.title,
            metric: k.metric,
            ...(k.metric === 'MILESTONE' ? {} : { startValue: Number(k.startValue ?? 0), targetValue: Number(k.targetValue), unit: k.metric === 'NUMBER' ? k.unit || null : null }),
            weight: Number(k.weight) || 1,
          })),
        });
    emit('saved', saved);
  } catch (e) {
    handle(e, 'Could not save the objective');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="editing ? 'Edit objective' : 'New objective'" :description="editing ? undefined : 'An objective is the outcome you want; key results are how you will know you got there.'" size="lg" @close="emit('close')">
    <form id="objective-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div v-if="!editing && levelOptions.length > 1">
        <p class="label">Level</p>
        <AppSegmented v-model="form.level" :options="levelOptions" label="Objective level" />
      </div>
      <AppInput v-model="form.title" label="Objective" required :maxlength="200" placeholder="e.g. Delight customers with a faster checkout" :error="fieldErrors.title" />
      <AppTextarea v-model="form.description" label="Why it matters (optional)" :rows="2" :maxlength="2000" :error="fieldErrors.description" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-if="!editing && form.level === 'DEPARTMENT' && !can.departmentId"
          v-model="form.departmentId"
          label="Department"
          required
          :options="departments"
          searchable
          :error="fieldErrors.departmentId"
        />
        <AppSelect
          v-if="!editing && form.level !== 'COMPANY' && can.forOthers"
          v-model="form.ownerEmployeeId"
          :label="form.level === 'INDIVIDUAL' ? 'Whose objective' : 'Owner (optional)'"
          :options="people"
          searchable
          remote
          :placeholder="form.level === 'INDIVIDUAL' ? 'Me' : 'Search by name…'"
          :error="fieldErrors.ownerEmployeeId"
          @search="search"
        />
        <AppSelect v-model="quarter" label="Period" :options="quarterOptions" :clearable="false" />
        <AppSelect v-model="form.parentId" label="Supports (optional)" :options="parents" searchable placeholder="Not aligned" :error="fieldErrors.parentId" />
      </div>
      <div v-if="quarter === 'custom'" class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.periodStart" label="From" required :error="fieldErrors.periodStart" />
        <AppDatePicker v-model="form.periodEnd" label="To" required :min="form.periodStart" :error="fieldErrors.periodEnd" />
      </div>

      <div v-if="!editing">
        <p class="label">Key results</p>
        <ul class="space-y-3">
          <li v-for="(k, i) in form.keyResults" :key="i" class="rounded-lg border border-line/80 bg-surface-muted/30 p-3">
            <div class="flex items-start gap-2">
              <AppInput v-model="k.title" class="min-w-0 flex-1" :aria-label="`Key result ${i + 1}`" placeholder="e.g. Cut checkout time to under 30 seconds" :maxlength="200" />
              <AppSelect v-model="k.metric" class="w-44 shrink-0 max-sm:hidden" :aria-label="`Key result ${i + 1} measured as`" :options="metricOptions" :clearable="false" />
              <AppButton variant="ghost" :icon="Trash2" :disabled="form.keyResults.length === 1" :aria-label="`Remove key result ${i + 1}`" @click="form.keyResults.splice(i, 1)" />
            </div>
            <AppSelect v-model="k.metric" class="mt-2 sm:hidden" :aria-label="`Key result ${i + 1} measured as`" :options="metricOptions" :clearable="false" />
            <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <template v-if="k.metric !== 'MILESTONE'">
                <AppInput v-model="k.startValue" type="number" label="From" />
                <AppInput v-model="k.targetValue" type="number" label="Target" />
                <AppInput v-if="k.metric === 'NUMBER'" v-model="k.unit" label="Unit" placeholder="e.g. deals" :maxlength="20" />
              </template>
              <AppInput v-model="k.weight" type="number" :min="1" :max="10" label="Weight" :class="k.metric === 'MILESTONE' ? 'col-start-1' : k.metric !== 'NUMBER' ? 'sm:col-start-4' : ''" />
            </div>
          </li>
        </ul>
        <AppButton class="mt-2" size="sm" variant="secondary" :icon="Plus" :disabled="form.keyResults.length >= OKR_MAX_KEY_RESULTS" @click="form.keyResults.push(blankKr())">Add key result</AppButton>
        <p class="mt-1.5 text-xs text-fg-subtle">Weight decides how much each key result counts towards the objective's progress.</p>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="objective-form" :loading="saving" :disabled="!canSave">{{ editing ? 'Save' : 'Create objective' }}</AppButton>
    </template>
  </AppModal>
</template>
