<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { SalaryComponentDef } from '@/modules/payroll/types';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add or edit a salary component (an earning used in structures). */
const props = defineProps<{ open: boolean; component: SalaryComponentDef | null }>();
const emit = defineEmits<{ close: []; saved: [c: SalaryComponentDef] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ code: '', name: '', description: '', role: null as 'BASIC' | 'HRA' | null, taxable: true, pfWage: false, esiWage: true, isActive: true });
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const c = props.component;
    Object.assign(form, { code: c?.code ?? '', name: c?.name ?? '', description: c?.description ?? '', role: c?.role ?? null, taxable: c?.taxable ?? true, pfWage: c?.pfWage ?? false, esiWage: c?.esiWage ?? true, isActive: c?.isActive ?? true });
  },
  { immediate: true },
);
const roleOptions = [
  { value: 'BASIC', label: 'Basic salary', description: 'PF, HRA exemption and % of Basic lines use it' },
  { value: 'HRA', label: 'House rent allowance', description: 'Used for the old-regime HRA exemption' },
];

async function save() {
  reset();
  saving.value = true;
  const body = { name: form.name, description: form.description || null, role: form.role, taxable: form.taxable, pfWage: form.pfWage, esiWage: form.esiWage, isActive: form.isActive };
  try {
    emit('saved', props.component ? await payrollApi.updateComponent(props.component.id, body) : await payrollApi.createComponent({ ...body, code: form.code }));
  } catch (e) {
    handle(e, 'Could not save the component');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="component ? `Edit ${component.name}` : 'New salary component'" @close="emit('close')">
    <form id="component-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[140px_1fr]">
        <AppInput v-model="form.code" label="Code" required :disabled="!!component" placeholder="LTA" :maxlength="20" :error="fieldErrors.code" />
        <AppInput v-model="form.name" label="Name" required placeholder="Leave travel allowance" :error="fieldErrors.name" />
      </div>
      <AppTextarea v-model="form.description" label="Description" :rows="2" :maxlength="300" />
      <AppSelect v-model="form.role" label="Special role" placeholder="None" :options="roleOptions" />
      <div class="space-y-3">
        <AppCheckbox v-model="form.taxable" label="Taxable" description="Counted as taxable salary for TDS." />
        <AppCheckbox v-model="form.pfWage" label="Part of PF wages" description="Provident fund is worked out on these components (normally Basic and DA)." />
        <AppCheckbox v-model="form.esiWage" label="Part of ESI wages" />
        <AppCheckbox v-if="component" v-model="form.isActive" label="Active" description="Inactive components can't be added to structures." />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="component-form" :loading="saving" :disabled="form.name.trim().length < 2 || (!component && form.code.trim().length < 2)">Save</AppButton>
    </template>
  </AppModal>
</template>
