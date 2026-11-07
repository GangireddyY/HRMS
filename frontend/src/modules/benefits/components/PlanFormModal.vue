<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import { BENEFIT_TYPES, DEPENDENT_RELATIONS, EMPLOYMENT_TYPES, MAX_PLAN_OPTIONS, type BenefitType, type DependentRelation, type EmploymentType } from '@contracts';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import ChipPicker from '@/modules/benefits/components/ChipPicker.vue';
import type { Plan, PlanInput } from '@/modules/benefits/types';
import { RELATION_LABELS, TYPE_LABELS } from '@/modules/benefits/utils/benefits-format';
import { structureApi } from '@/modules/people/api/people.api';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit a benefit plan: policy, enrolment window, eligibility and coverage options. */
const props = defineProps<{ open: boolean; plan: Plan | null }>();
const emit = defineEmits<{ close: []; saved: [p: Plan] }>();

interface OptionForm {
  id?: string;
  name: string;
  coverageAmount: string | number;
  employeeMonthly: string | number;
  employerMonthly: string | number;
  allowedRelations: DependentRelation[];
  maxDependents: string | number;
  isDefault: boolean;
}
const blankOption = (name = ''): OptionForm => ({ name, coverageAmount: '', employeeMonthly: 0, employerMonthly: 0, allowedRelations: [], maxDependents: 0, isDefault: false });

const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const locations = useAsync(() => structureApi.locations(), { immediate: false });
const grades = useAsync(() => structureApi.grades(), { immediate: false });
const form = reactive({
  name: '',
  type: 'HEALTH' as BenefitType,
  provider: '',
  policyNumber: '',
  description: '',
  coverageStartsOn: undefined as string | undefined,
  coverageEndsOn: undefined as string | undefined,
  enrollmentOpensOn: undefined as string | undefined,
  enrollmentClosesOn: undefined as string | undefined,
  mandatory: false,
  requiresApproval: false,
  employmentTypes: [] as EmploymentType[],
  departmentIds: [] as string[],
  locationIds: [] as string[],
  gradeIds: [] as string[],
  waitingDays: 0 as string | number,
  maxChildAge: '' as string | number,
  options: [] as OptionForm[],
});
const saving = ref(false);
const active = computed(() => props.plan?.status === 'ACTIVE');
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    for (const s of [departments, locations, grades]) if (!s.data.value) void s.run();
    const p = props.plan;
    Object.assign(form, {
      name: p?.name ?? '',
      type: p?.type ?? 'HEALTH',
      provider: p?.provider ?? '',
      policyNumber: p?.policyNumber ?? '',
      description: p?.description ?? '',
      coverageStartsOn: p?.coverageStartsOn,
      coverageEndsOn: p?.coverageEndsOn,
      enrollmentOpensOn: p?.enrollmentOpensOn ?? undefined,
      enrollmentClosesOn: p?.enrollmentClosesOn ?? undefined,
      mandatory: p?.mandatory ?? false,
      requiresApproval: p?.requiresApproval ?? false,
      employmentTypes: [...(p?.employmentTypes ?? [])],
      departmentIds: [...(p?.departmentIds ?? [])],
      locationIds: [...(p?.locationIds ?? [])],
      gradeIds: [...(p?.gradeIds ?? [])],
      waitingDays: p?.waitingDays ?? 0,
      maxChildAge: p?.maxChildAge ?? '',
      options: p
        ? p.options.map((o) => ({ ...o, coverageAmount: o.coverageAmount ?? '', allowedRelations: [...o.allowedRelations] }))
        : [blankOption('Employee only'), { ...blankOption('Employee + family'), allowedRelations: ['SPOUSE', 'CHILD'], maxDependents: 3 }],
    });
  },
  { immediate: true },
);
const typeOptions = BENEFIT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));
const toOptions = (rows: { id: string; name: string; isActive?: boolean }[] | null | undefined) => (rows ?? []).filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name }));
function toggle<T>(list: T[], value: T, on: boolean) {
  const i = list.indexOf(value);
  if (on && i < 0) list.push(value);
  if (!on && i >= 0) list.splice(i, 1);
}
function setDefault(i: number, on: boolean) {
  form.options.forEach((o, j) => (o.isDefault = on && i === j));
}
const canSave = computed(() => form.name.trim().length >= 3 && !!form.coverageStartsOn && !!form.coverageEndsOn && form.options.length > 0 && form.options.every((o) => o.name.trim().length >= 2));
const n = (v: string | number) => (v === '' || v === null ? null : Number(v));

async function save() {
  reset();
  saving.value = true;
  const body: PlanInput = {
    name: form.name,
    type: form.type,
    provider: form.provider || null,
    policyNumber: form.policyNumber || null,
    description: form.description || null,
    coverageStartsOn: form.coverageStartsOn!,
    coverageEndsOn: form.coverageEndsOn!,
    enrollmentOpensOn: form.enrollmentOpensOn ?? null,
    enrollmentClosesOn: form.enrollmentClosesOn ?? null,
    mandatory: form.mandatory,
    requiresApproval: form.requiresApproval,
    employmentTypes: form.employmentTypes.length ? form.employmentTypes : null,
    departmentIds: form.departmentIds.length ? form.departmentIds : null,
    locationIds: form.locationIds.length ? form.locationIds : null,
    gradeIds: form.gradeIds.length ? form.gradeIds : null,
    waitingDays: Number(form.waitingDays) || 0,
    maxChildAge: n(form.maxChildAge),
    options: form.options.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      name: o.name,
      coverageAmount: n(o.coverageAmount),
      employeeMonthly: Number(o.employeeMonthly) || 0,
      employerMonthly: Number(o.employerMonthly) || 0,
      allowedRelations: Number(o.maxDependents) > 0 ? o.allowedRelations : [],
      maxDependents: Number(o.maxDependents) || 0,
      isDefault: o.isDefault,
    })),
  };
  try {
    emit('saved', props.plan ? await benefitsApi.updatePlan(props.plan.id, body) : await benefitsApi.createPlan(body));
  } catch (e) {
    handle(e, 'Could not save the plan');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="plan ? `Edit ${plan.name}` : 'New benefit plan'" :description="active ? 'Changes to cost apply to new enrolments; the type and policy start are fixed.' : 'Saved as a draft; activate it to open enrolment.'" size="xl" @close="emit('close')">
    <form id="plan-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_220px]">
        <AppInput v-model="form.name" label="Plan name" required :maxlength="150" placeholder="e.g. Group health insurance 2026-27" :error="fieldErrors.name" />
        <AppSelect v-model="form.type" label="Type" :options="typeOptions" :clearable="false" :disabled="active" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.provider" label="Insurer / provider" :maxlength="150" />
        <AppInput v-model="form.policyNumber" label="Policy number" :maxlength="80" />
      </div>
      <AppTextarea v-model="form.description" label="What it covers" :rows="3" :maxlength="4000" help="Shown to employees: inclusions, exclusions, how to claim." />

      <fieldset class="grid gap-4 rounded-xl p-4 ring-1 ring-line sm:grid-cols-2">
        <legend class="px-1 text-sm font-medium text-fg">Dates</legend>
        <AppDatePicker v-model="form.coverageStartsOn" label="Policy starts" required :disabled="active" :error="fieldErrors.coverageStartsOn" />
        <AppDatePicker v-model="form.coverageEndsOn" label="Policy ends" required :error="fieldErrors.coverageEndsOn" />
        <AppDatePicker v-model="form.enrollmentOpensOn" label="Enrolment opens" help="Optional open enrolment window." :error="fieldErrors.enrollmentOpensOn" />
        <AppDatePicker v-model="form.enrollmentClosesOn" label="Enrolment closes" :error="fieldErrors.enrollmentClosesOn" />
        <p class="text-xs text-fg-muted sm:col-span-2">New joiners can always enrol within 30 days of becoming eligible, and anyone within 30 days of a life event (approved by HR).</p>
      </fieldset>

      <fieldset class="space-y-4 rounded-xl p-4 ring-1 ring-line">
        <legend class="px-1 text-sm font-medium text-fg">Eligibility</legend>
        <div>
          <p class="label">Employment types</p>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <AppCheckbox v-for="t in EMPLOYMENT_TYPES" :key="t" :model-value="form.employmentTypes.includes(t)" :label="EMPLOYMENT_TYPE_LABELS[t]" @update:model-value="(on: boolean) => toggle(form.employmentTypes, t, on)" />
          </div>
          <p class="mt-1 text-xs text-fg-muted">None ticked = all employment types.</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <ChipPicker v-model="form.departmentIds" label="Departments" placeholder="All departments" :options="toOptions(departments.data.value)" />
          <ChipPicker v-model="form.locationIds" label="Locations" placeholder="All locations" :options="toOptions(locations.data.value)" />
          <ChipPicker v-model="form.gradeIds" label="Grades" placeholder="All grades" :options="toOptions(grades.data.value)" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.waitingDays" label="Waiting period (days after joining)" type="number" :min="0" :max="365" :error="fieldErrors.waitingDays" />
          <AppInput v-model="form.maxChildAge" label="Children covered up to age" type="number" :min="1" :max="30" placeholder="No limit" :error="fieldErrors.maxChildAge" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <AppCheckbox v-model="form.mandatory" label="Mandatory" description="Everyone eligible is enrolled in the default option and can't waive it." />
          <AppCheckbox v-model="form.requiresApproval" label="HR approves enrolments" description="Otherwise choices made in a window take effect immediately." />
        </div>
      </fieldset>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-fg">Coverage options</h3>
          <AppButton size="sm" variant="secondary" :icon="Plus" :disabled="form.options.length >= MAX_PLAN_OPTIONS" @click="form.options.push(blankOption())">Add option</AppButton>
        </div>
        <AppAlert v-if="fieldErrors.options" tone="error">{{ fieldErrors.options }}</AppAlert>
        <div v-for="(o, i) in form.options" :key="o.id ?? i" class="space-y-3 rounded-xl p-4 ring-1 ring-line">
          <div class="grid items-start gap-3 sm:grid-cols-[1fr_auto]">
            <AppInput v-model="o.name" :label="`Option ${i + 1}`" :maxlength="120" :error="fieldErrors[`options.${i}.name`]" />
            <AppButton class="sm:mt-4" size="sm" variant="ghost" :icon="Trash2" :disabled="form.options.length === 1" :aria-label="`Remove option ${i + 1}`" @click="form.options.splice(i, 1)" />
          </div>
          <div class="grid gap-3 sm:grid-cols-4">
            <AppInput v-model="o.coverageAmount" :label="`Option ${i + 1} sum insured (₹)`" type="number" :min="1" placeholder="Not applicable" />
            <AppInput v-model="o.employeeMonthly" :label="`Option ${i + 1} employee pays / month (₹)`" type="number" :min="0" />
            <AppInput v-model="o.employerMonthly" :label="`Option ${i + 1} employer pays / month (₹)`" type="number" :min="0" />
            <AppInput v-model="o.maxDependents" :label="`Option ${i + 1} dependants covered`" type="number" :min="0" :max="10" :error="fieldErrors[`options.${i}.maxDependents`]" />
          </div>
          <div v-if="Number(o.maxDependents) > 0">
            <p class="label">Who it can cover</p>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <AppCheckbox v-for="r in DEPENDENT_RELATIONS" :key="r" :model-value="o.allowedRelations.includes(r)" :label="RELATION_LABELS[r]" @update:model-value="(on: boolean) => toggle(o.allowedRelations, r, on)" />
            </div>
            <p v-if="fieldErrors[`options.${i}.allowedRelations`]" class="error-text" role="alert">{{ fieldErrors[`options.${i}.allowedRelations`] }}</p>
          </div>
          <AppCheckbox :model-value="o.isDefault" label="Default option" description="Used when HR enrols everyone in a mandatory plan." @update:model-value="(on: boolean) => setDefault(i, on)" />
        </div>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="plan-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
