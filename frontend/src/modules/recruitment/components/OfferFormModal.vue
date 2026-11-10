<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { structureApi } from '@/modules/people/api/people.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { OfferSummary } from '@/modules/recruitment/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { localToday } from '@/shared/utils/dates';

/** Draft (or edit a draft) offer. Department, designation and location default from the requisition. */
const props = defineProps<{ open: boolean; applicationId: string; offer: OfferSummary | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const designations = useAsync(() => structureApi.designations(), { immediate: false });
const locations = useAsync(() => structureApi.locations(), { immediate: false });
const form = reactive({ annualCtc: '' as number | string, joiningDate: undefined as string | undefined, expiresOn: undefined as string | undefined, departmentId: null as string | null, designationId: null as string | null, locationId: null as string | null, notes: '' });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    for (const a of [departments, designations, locations]) if (!a.data.value) void a.run();
    const o = props.offer;
    Object.assign(form, { annualCtc: o?.annualCtc ?? '', joiningDate: o?.joiningDate ?? undefined, expiresOn: o?.expiresOn ?? undefined, departmentId: o?.departmentId ?? null, designationId: o?.designationId ?? null, locationId: o?.locationId ?? null, notes: o?.notes ?? '' });
  },
  { immediate: true },
);
const opts = (rows: { id: string; name: string; isActive?: boolean }[] | null | undefined) => (rows ?? []).filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name }));
const today = localToday();
const canSave = computed(() => Number(form.annualCtc) > 0 && !!form.joiningDate);

async function save() {
  reset();
  saving.value = true;
  const body = { annualCtc: Number(form.annualCtc), joiningDate: form.joiningDate!, expiresOn: form.expiresOn ?? null, notes: form.notes || null, ...(props.offer || form.departmentId ? { departmentId: form.departmentId } : {}), ...(props.offer || form.designationId ? { designationId: form.designationId } : {}), ...(props.offer || form.locationId ? { locationId: form.locationId } : {}) };
  try {
    if (props.offer) await recruitmentApi.updateOffer(props.offer.id, body);
    else await recruitmentApi.createOffer(props.applicationId, body);
    emit('saved');
  } catch (e) {
    handle(e, 'Could not save the offer');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="offer ? 'Edit offer' : 'Draft offer'" description="Release it once it's final; record the candidate's answer afterwards." @close="emit('close')">
    <form id="offer-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="form.annualCtc" label="Annual CTC" type="number" :min="1" required :error="fieldErrors.annualCtc" />
        <AppDatePicker v-model="form.joiningDate" label="Joining date" required :min="today" :error="fieldErrors.joiningDate" />
        <AppDatePicker v-model="form.expiresOn" label="Offer valid until" :min="today" :max="form.joiningDate" :error="fieldErrors.expiresOn" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect v-model="form.designationId" label="Designation" placeholder="From requisition" :options="opts(designations.data.value)" />
        <AppSelect v-model="form.departmentId" label="Department" placeholder="From requisition" :options="opts(departments.data.value)" />
        <AppSelect v-model="form.locationId" label="Location" placeholder="From requisition" :options="opts(locations.data.value)" />
      </div>
      <AppTextarea v-model="form.notes" label="Notes" :rows="2" :maxlength="2000" placeholder="Joining bonus, special terms…" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="offer-form" :loading="saving" :disabled="!canSave">{{ offer ? 'Save offer' : 'Save draft' }}</AppButton>
    </template>
  </AppModal>
</template>
