<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Check, Eye, EyeOff, Lock, Pencil, Save, ShieldAlert, X } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import type { SensitiveDetails } from '@/modules/people/types';
import { AppAlert, AppButton, AppCard, AppDatePicker, AppInput } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Bank and statutory identifiers: hidden until revealed (each reveal is audited), editable with employee.update. */
const props = defineProps<{ employeeId: string; hasBankAccount: boolean; canEdit: boolean }>();

const feedback = useFeedbackStore();
const details = ref<SensitiveDetails | null>(null);
const loading = ref(false);
const editing = ref(false);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ pan: '', uan: '', esiNumber: '', bankAccountNumber: '', bankIfsc: '', bankName: '', aadhaar: '', passportNumber: '', passportExpiry: undefined as string | undefined });

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
    esiNumber: d?.esiNumber ?? '',
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
    const hadPending = details.value?.pendingBankChange?.id;
    details.value = await employeesApi.updateSensitive(props.employeeId, { ...form, passportExpiry: form.passportExpiry ?? null });
    editing.value = false;
    if (details.value.pendingBankChange && details.value.pendingBankChange.id !== hadPending) {
      feedback.info('Bank account change sent for approval', 'Another HR colleague must approve it. Salary stays with the current account until then; the employee has been told.');
    } else feedback.success('Bank, statutory and identity details saved');
  } catch (e) {
    handle(e, 'Could not save details');
  } finally {
    saving.value = false;
  }
}

const reviewing = ref<'approve' | 'reject' | null>(null);
const rejectNote = ref('');
async function review(action: 'approve' | 'reject') {
  const change = details.value?.pendingBankChange;
  if (!change) return;
  if (action === 'reject' && rejectNote.value.trim().length < 3) {
    feedback.warning('Say why the change is rejected');
    return;
  }
  reviewing.value = action;
  try {
    if (action === 'approve') await employeesApi.approveBankChange(change.id);
    else await employeesApi.rejectBankChange(change.id, rejectNote.value.trim());
    feedback.success(action === 'approve' ? 'Bank account change approved' : 'Bank account change rejected', 'The employee has been told.');
    rejectNote.value = '';
    details.value = await employeesApi.sensitive(props.employeeId);
  } catch (e) {
    feedback.error('Could not update the bank account change', e);
  } finally {
    reviewing.value = null;
  }
}

const rows: { key: Exclude<keyof SensitiveDetails, 'pendingBankChange'>; label: string }[] = [
  { key: 'pan', label: 'PAN' },
  { key: 'uan', label: 'UAN (PF)' },
  { key: 'esiNumber', label: 'ESI number' },
  { key: 'bankName', label: 'Bank' },
  { key: 'bankAccountNumber', label: 'Account number' },
  { key: 'bankIfsc', label: 'IFSC' },
  { key: 'aadhaar', label: 'Aadhaar' },
  { key: 'passportNumber', label: 'Passport' },
  { key: 'passportExpiry', label: 'Passport expires' },
];
const display = (key: Exclude<keyof SensitiveDetails, 'pendingBankChange'>, v: string | null) => (v && key === 'passportExpiry' ? formatDate(v) : v && key === 'aadhaar' ? v.replace(/(\d{4})(?=\d)/g, '$1 ') : (v ?? '—'));
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

    <div v-if="details?.pendingBankChange && !editing" class="mb-4 space-y-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg ring-1 ring-warning/25 ring-inset" role="status">
      <div class="flex items-start gap-2.5">
        <ShieldAlert :size="17" class="mt-0.5 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <p class="font-semibold">Bank account change waiting for approval</p>
          <p class="mt-0.5">
            New account ••••{{ details.pendingBankChange.accountLast4 ?? '—' }}{{ details.pendingBankChange.ifsc ? ` · ${details.pendingBankChange.ifsc}` : '' }}{{ details.pendingBankChange.bankName ? ` · ${details.pendingBankChange.bankName}` : '' }}
            — requested{{ details.pendingBankChange.requestedBy ? ` by ${details.pendingBankChange.requestedBy}` : '' }} {{ timeAgo(details.pendingBankChange.requestedAt) }}. Salary is paid to the current account until it's approved.
          </p>
        </div>
      </div>
      <div v-if="details.pendingBankChange.canReview" class="flex flex-wrap items-center gap-2 ps-7">
        <AppInput v-model="rejectNote" class="min-w-48 flex-1" size="md" placeholder="Reason, if you reject it" aria-label="Reason for rejecting" :maxlength="500" />
        <AppButton size="sm" variant="secondary" :icon="X" :loading="reviewing === 'reject'" :disabled="!!reviewing" @click="review('reject')">Reject</AppButton>
        <AppButton size="sm" :icon="Check" :loading="reviewing === 'approve'" :disabled="!!reviewing" @click="review('approve')">Approve change</AppButton>
      </div>
      <p v-else class="ps-7 text-xs">Someone else with access to sensitive details must approve it (not the requester or the employee).</p>
    </div>
    <p v-if="!details" class="text-sm text-fg-muted">{{ hasBankAccount ? 'Bank account on file. Show details to view.' : 'No bank account on file yet.' }}</p>
    <form v-else-if="editing" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.pan" label="PAN" placeholder="ABCDE1234F" :error="fieldErrors.pan" />
        <AppInput v-model="form.uan" label="UAN (PF)" placeholder="12 digits" inputmode="numeric" :error="fieldErrors.uan" />
        <AppInput v-model="form.esiNumber" label="ESI number (IP)" placeholder="10 or 17 digits" inputmode="numeric" :error="fieldErrors.esiNumber" />
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
    <dl v-else class="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      <div v-for="r in rows" :key="r.key">
        <dt class="text-xs text-fg-muted">{{ r.label }}</dt>
        <dd class="mt-0.5 font-mono text-fg">{{ display(r.key, details[r.key]) }}</dd>
      </div>
    </dl>
  </AppCard>
</template>
