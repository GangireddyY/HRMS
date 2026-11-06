<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Eye, EyeOff, Lock, Pencil, Save } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import type { SensitiveDetails } from '@/modules/people/types';
import { AppAlert, AppButton, AppCard, AppDatePicker, AppInput } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Bank and statutory identifiers: hidden until revealed (each reveal is audited), editable with employee.update. */
const props = defineProps<{ employeeId: string; hasBankAccount: boolean; canEdit: boolean }>();

const feedback = useFeedbackStore();
const details = ref<SensitiveDetails | null>(null);
const loading = ref(false);
const editing = ref(false);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ pan: '', uan: '', bankAccountNumber: '', bankIfsc: '', bankName: '', aadhaar: '', passportNumber: '', passportExpiry: undefined as string | undefined });

async function reveal() {
  loading.value = true;
  try {
    details.value = await employeesApi.sensitive(props.employeeId);
  } catch (e) {
    feedback.error('Could not load details', e);
  } finally {
    loading.value = false;
  }
}

function startEdit() {
  const d = details.value;
  Object.assign(form, {
    pan: d?.pan ?? '',
    uan: d?.uan ?? '',
    bankAccountNumber: d?.bankAccountNumber ?? '',
    bankIfsc: d?.bankIfsc ?? '',
    bankName: d?.bankName ?? '',
    aadhaar: d?.aadhaar ?? '',
    passportNumber: d?.passportNumber ?? '',
    passportExpiry: d?.passportExpiry ?? undefined,
  });
  reset();
  editing.value = true;
}

async function save() {
  reset();
  saving.value = true;
  try {
    details.value = await employeesApi.updateSensitive(props.employeeId, { ...form, passportExpiry: form.passportExpiry ?? null });
    editing.value = false;
    feedback.success('Bank, statutory and identity details saved');
  } catch (e) {
    handle(e, 'Could not save details');
  } finally {
    saving.value = false;
  }
}

const rows: { key: keyof SensitiveDetails; label: string }[] = [
  { key: 'pan', label: 'PAN' },
  { key: 'uan', label: 'UAN (PF)' },
  { key: 'bankName', label: 'Bank' },
  { key: 'bankAccountNumber', label: 'Account number' },
  { key: 'bankIfsc', label: 'IFSC' },
  { key: 'aadhaar', label: 'Aadhaar' },
  { key: 'passportNumber', label: 'Passport' },
  { key: 'passportExpiry', label: 'Passport expires' },
];
const display = (key: keyof SensitiveDetails, v: string | null) => (v && key === 'passportExpiry' ? formatDate(v) : v && key === 'aadhaar' ? v.replace(/(\d{4})(?=\d)/g, '$1 ') : (v ?? '—'));
</script>

<template>
  <AppCard title="Bank, statutory & identity" :icon="Lock" description="Encrypted at rest. Every view is recorded in the audit log.">
    <template #actions>
      <AppButton v-if="!details" size="sm" variant="secondary" :icon="Eye" :loading="loading" @click="reveal">Show details</AppButton>
      <template v-else-if="!editing">
        <AppButton size="sm" variant="ghost" :icon="EyeOff" @click="details = null">Hide</AppButton>
        <AppButton v-if="canEdit" size="sm" variant="secondary" :icon="Pencil" @click="startEdit">Edit</AppButton>
      </template>
    </template>

    <p v-if="!details" class="text-sm text-fg-muted">{{ hasBankAccount ? 'Bank account on file. Show details to view.' : 'No bank account on file yet.' }}</p>
    <form v-else-if="editing" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.pan" label="PAN" placeholder="ABCDE1234F" :error="fieldErrors.pan" />
        <AppInput v-model="form.uan" label="UAN (PF)" placeholder="12 digits" inputmode="numeric" :error="fieldErrors.uan" />
        <AppInput v-model="form.bankName" label="Bank name" :error="fieldErrors.bankName" />
        <AppInput v-model="form.bankAccountNumber" label="Account number" inputmode="numeric" :error="fieldErrors.bankAccountNumber" />
        <AppInput v-model="form.bankIfsc" label="IFSC" placeholder="HDFC0001234" :error="fieldErrors.bankIfsc" />
        <AppInput v-model="form.aadhaar" label="Aadhaar" placeholder="12 digits" inputmode="numeric" :error="fieldErrors.aadhaar" />
        <AppInput v-model="form.passportNumber" label="Passport number" :error="fieldErrors.passportNumber" />
        <AppDatePicker v-model="form.passportExpiry" label="Passport expiry" :error="fieldErrors.passportExpiry" />
      </div>
      <div class="flex justify-end gap-2">
        <AppButton variant="secondary" @click="editing = false">Cancel</AppButton>
        <AppButton type="submit" :icon="Save" :loading="saving">Save</AppButton>
      </div>
    </form>
    <dl v-else class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div v-for="r in rows" :key="r.key">
        <dt class="text-xs text-fg-muted">{{ r.label }}</dt>
        <dd class="mt-0.5 font-mono text-fg">{{ display(r.key, details[r.key]) }}</dd>
      </div>
    </dl>
  </AppCard>
</template>
