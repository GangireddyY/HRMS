<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { REQUISITION_REASONS, type EmploymentType, type RequisitionReason } from '@contracts';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import { employmentTypeOptions } from '@/modules/people/utils/labels';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { Requisition } from '@/modules/recruitment/types';
import { REASON_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Raise (or edit a draft / rejected) manpower requisition. */
const props = defineProps<{ open: boolean; requisition: Requisition | null }>();
const emit = defineEmits<{ close: []; saved: [r: Requisition] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref<'draft' | 'submit' | null>(null);
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const designations = useAsync(() => structureApi.designations(), { immediate: false });
const locations = useAsync(() => structureApi.locations(), { immediate: false });
const people = useAsync(() => employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }).catch(() => null), { immediate: false });
const form = reactive({
  title: '',
  departmentId: null as string | null,
  designationId: null as string | null,
  locationId: null as string | null,
  hiringManagerId: null as string | null,
  employmentType: 'FULL_TIME' as EmploymentType,
  openings: 1 as number | string,
  reason: 'NEW_ROLE' as RequisitionReason,
  justification: '',
  budgetMin: '' as number | string,
  budgetMax: '' as number | string,
  targetDate: undefined as string | undefined,
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    for (const a of [departments, designations, locations, people]) if (!a.data.value) void a.run();
    const r = props.requisition;
    Object.assign(form, {
      title: r?.title ?? '',
      departmentId: r?.department?.id ?? null,
      designationId: r?.designation?.id ?? null,
      locationId: r?.location?.id ?? null,
      hiringManagerId: r?.hiringManager?.id ?? null,
      employmentType: r?.employmentType ?? 'FULL_TIME',
      openings: r?.openings ?? 1,
      reason: r?.reason ?? 'NEW_ROLE',
      justification: r?.justification ?? '',
      budgetMin: r?.budgetMin ?? '',
      budgetMax: r?.budgetMax ?? '',
      targetDate: r?.targetDate ?? undefined,
    });
  },
  { immediate: true },
);

const opts = (rows: { id: string; name: string; isActive?: boolean }[] | null | undefined) => (rows ?? []).filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name }));
const managerOptions = computed(() => (people.data.value?.items ?? []).map((e) => ({ value: e.id, label: e.fullName, description: e.designation?.name })));
const reasonOptions = REQUISITION_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }));
const n = (v: number | string) => (v === '' ? null : Number(v));
const canSave = computed(() => form.title.trim().length >= 2 && form.justification.trim().length >= 10);

async function save(submit: boolean) {
  reset();
  saving.value = submit ? 'submit' : 'draft';
  const body = {
    ...form,
    openings: Number(form.openings) || 1,
    budgetMin: n(form.budgetMin),
    budgetMax: n(form.budgetMax),
    targetDate: form.targetDate ?? null,
    ...(people.data.value ? {} : { hiringManagerId: undefined }),
    submit,
  };
  try {
    emit('saved', props.requisition ? await recruitmentApi.updateRequisition(props.requisition.id, body) : await recruitmentApi.createRequisition(body));
  } catch (e) {
    handle(e, 'Could not save the requisition');
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <AppModal :open="open" :title="requisition ? `Edit ${requisition.code}` : 'New requisition'" description="Request approval to hire. Once approved, recruiters open the job." size="lg" @close="emit('close')">
    <form class="space-y-4" novalidate @submit.prevent="save(true)">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_120px]">
        <AppInput v-model="form.title" label="Position" required placeholder="e.g. Senior Backend Engineer" :error="fieldErrors.title" />
        <AppInput v-model="form.openings" label="Openings" type="number" :min="1" :max="500" :error="fieldErrors.openings" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect v-model="form.departmentId" label="Department" placeholder="Your department" :options="opts(departments.data.value)" />
        <AppSelect v-model="form.designationId" label="Designation" placeholder="None" :options="opts(designations.data.value)" />
        <AppSelect v-model="form.locationId" label="Location" placeholder="None" :options="opts(locations.data.value)" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect v-model="form.employmentType" label="Employment type" :options="employmentTypeOptions" :clearable="false" />
        <AppSelect v-model="form.reason" label="Reason" :options="reasonOptions" :clearable="false" />
        <AppDatePicker v-model="form.targetDate" label="Needed by" />
      </div>
      <AppSelect v-if="people.data.value" v-model="form.hiringManagerId" label="Hiring manager" placeholder="You" :options="managerOptions" searchable />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.budgetMin" label="Budget from (annual CTC)" type="number" :min="0" :error="fieldErrors.budgetMin" />
        <AppInput v-model="form.budgetMax" label="Budget to (annual CTC)" type="number" :min="0" :error="fieldErrors.budgetMax" />
      </div>
      <AppTextarea v-model="form.justification" label="Business justification" required :rows="3" :maxlength="1000" :error="fieldErrors.justification" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="secondary" :loading="saving === 'draft'" :disabled="!canSave || !!saving" @click="save(false)">Save draft</AppButton>
      <AppButton :loading="saving === 'submit'" :disabled="!canSave || !!saving" @click="save(true)">Submit for approval</AppButton>
    </template>
  </AppModal>
</template>
