<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { EXIT_REASONS, EXIT_TYPES, type ExitReason, type ExitType } from '@contracts';
import { exitApi } from '@/modules/exit/api/exit.api';
import type { ExitDetail } from '@/modules/exit/types';
import { REASON_LABELS, TYPE_LABELS, localIso } from '@/modules/exit/utils/exit-format';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Records an employer-initiated exit (termination, retirement, end of contract, death…), confirmed straight away. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [e: ExitDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const today = localIso(new Date());
const form = reactive({
  employeeId: null as string | null,
  type: 'TERMINATION' as ExitType,
  reason: 'PERFORMANCE' as ExitReason,
  reasonDetail: '',
  noticeGivenOn: today as string | undefined,
  lastWorkingDay: undefined as string | undefined,
  noticeDays: '' as string | number,
  waiveNotice: false,
});
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { employeeId: null, type: 'TERMINATION', reason: 'PERFORMANCE', reasonDetail: '', noticeGivenOn: today, lastWorkingDay: undefined, noticeDays: '', waiveNotice: false });
  },
);
const typeOptions = EXIT_TYPES.filter((t) => t !== 'RESIGNATION').map((t) => ({ value: t, label: TYPE_LABELS[t] }));
const reasonOptions = EXIT_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }));
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items.map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
const canSave = computed(() => !!form.employeeId && !!form.noticeGivenOn && !!form.lastWorkingDay);

async function save() {
  reset();
  saving.value = true;
  try {
    emit(
      'saved',
      await exitApi.initiate({
        employeeId: form.employeeId!,
        type: form.type,
        reason: form.reason,
        reasonDetail: form.reasonDetail || null,
        noticeGivenOn: form.noticeGivenOn!,
        lastWorkingDay: form.lastWorkingDay!,
        ...(form.noticeDays === '' ? {} : { noticeDays: Number(form.noticeDays) }),
        waiveNotice: form.waiveNotice,
      }),
    );
  } catch (e) {
    handle(e, 'Could not record the exit');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Record an exit" description="For separations started by the organization. Resignations are submitted by employees." size="lg" @close="emit('close')">
    <form id="initiate-exit-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <ColleaguePicker v-model:value="form.employeeId" label="Employee" required :source="search" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.type" label="Type" :options="typeOptions" :clearable="false" />
        <AppSelect v-model="form.reason" label="Reason" :options="reasonOptions" :clearable="false" />
      </div>
      <AppTextarea v-model="form.reasonDetail" label="Details" :rows="2" :maxlength="2000" help="Internal; not shown to the employee." />
      <div class="grid gap-4 sm:grid-cols-3">
        <AppDatePicker v-model="form.noticeGivenOn" label="Notice given on" required :error="fieldErrors.noticeGivenOn" />
        <AppDatePicker v-model="form.lastWorkingDay" label="Last working day" required :error="fieldErrors.lastWorkingDay" />
        <AppInput v-model="form.noticeDays" label="Notice period (days)" type="number" :min="0" :max="365" placeholder="Employee's default" :error="fieldErrors.noticeDays" />
      </div>
      <AppCheckbox v-model="form.waiveNotice" label="Waive the notice period" description="Otherwise notice not given is paid in lieu in the settlement." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="initiate-exit-form" :loading="saving" :disabled="!canSave">Record exit</AppButton>
    </template>
  </AppModal>
</template>
