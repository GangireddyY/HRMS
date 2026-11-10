<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { TRAVEL_MODES, type TravelMode } from '@contracts';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { travelApi } from '@/modules/services/api/services.api';
import type { Trip } from '@/modules/services/types';
import { nights, TRAVEL_MODE_LABELS } from '@/modules/services/utils/services-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Ask to travel for work: where, when, how, and what it will cost (with an optional advance). Your manager approves it. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [trip: Trip] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const blank = () => ({
  purpose: '',
  fromCity: '',
  toCity: '',
  departureDate: undefined as string | undefined,
  returnDate: undefined as string | undefined,
  mode: 'FLIGHT' as TravelMode,
  needsAccommodation: false,
  estimatedCost: '' as string | number,
  advanceAmount: '' as string | number,
});
const form = reactive(blank());
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, blank());
  },
);
const modeOptions = TRAVEL_MODES.map((m) => ({ value: m, label: TRAVEL_MODE_LABELS[m] }));
const stay = computed(() => (form.departureDate && form.returnDate && form.returnDate >= form.departureDate ? nights(form.departureDate, form.returnDate) : null));
const canSave = computed(
  () => form.purpose.trim().length >= 5 && form.fromCity.trim().length >= 2 && form.toCity.trim().length >= 2 && !!form.departureDate && !!form.returnDate && form.estimatedCost !== '',
);
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    emit(
      'saved',
      await travelApi.create({
        purpose: form.purpose,
        fromCity: form.fromCity,
        toCity: form.toCity,
        departureDate: form.departureDate!,
        returnDate: form.returnDate!,
        mode: form.mode,
        needsAccommodation: form.needsAccommodation,
        estimatedCost: Number(form.estimatedCost),
        advanceAmount: form.advanceAmount === '' ? 0 : Number(form.advanceAmount),
      }),
    );
  } catch (e) {
    handle(e, 'Could not send the request');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Request travel" description="Your manager approves it; the travel desk then books tickets and pays any advance. Claim actual expenses under Reimbursements after the trip." @close="emit('close')">
    <form id="travel-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppTextarea v-model="form.purpose" label="Purpose" placeholder="e.g. Quarterly business review with Acme Mumbai" required :rows="2" :maxlength="500" :error="fieldErrors.purpose" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.fromCity" label="From" placeholder="City" required :error="fieldErrors.fromCity" />
        <AppInput v-model="form.toCity" label="To" placeholder="City" required :error="fieldErrors.toCity" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppDatePicker v-model="form.departureDate" label="Leaving on" required :error="fieldErrors.departureDate" />
        <AppDatePicker v-model="form.returnDate" label="Back on" required :error="fieldErrors.returnDate" :help="stay === null ? undefined : stay === 0 ? 'Day trip' : `${stay} night${stay === 1 ? '' : 's'}`" />
        <AppSelect v-model="form.mode" label="Travelling by" :options="modeOptions" :clearable="false" />
      </div>
      <AppSwitch v-model="form.needsAccommodation" label="I need a hotel" description="The travel desk books it with the tickets." />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.estimatedCost" label="Estimated total cost (₹)" type="number" :min="0" required :error="fieldErrors.estimatedCost" help="Travel, stay and local expenses" />
        <AppInput
          v-model="form.advanceAmount"
          label="Advance needed (₹)"
          type="number"
          :min="0"
          :error="fieldErrors.advanceAmount"
          :help="form.estimatedCost !== '' ? `Up to ${rupees(Number(form.estimatedCost))}; settled against your expense claim` : 'Optional'"
        />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="travel-form" :loading="saving" :disabled="!canSave">Send for approval</AppButton>
    </template>
  </AppModal>
</template>
