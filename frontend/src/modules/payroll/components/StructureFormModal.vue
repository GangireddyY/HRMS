<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/vue';
import { COMPONENT_CALCULATIONS, type ComponentCalculation } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { SalaryComponentDef, SalaryStructure } from '@/modules/payroll/types';
import { CALCULATION_LABELS } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Salary structure editor: ordered lines, each a component with a rule; exactly one line is the balance. */
const props = defineProps<{ open: boolean; structure: SalaryStructure | null; components: SalaryComponentDef[] }>();
const emit = defineEmits<{ close: []; saved: [s: SalaryStructure] }>();

interface Line {
  key: number;
  componentId: string | null;
  calculation: ComponentCalculation;
  value: number | string;
}
let seq = 0;
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ name: '', description: '', isActive: true, lines: [] as Line[] });
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const s = props.structure;
    Object.assign(form, {
      name: s?.name ?? '',
      description: s?.description ?? '',
      isActive: s?.isActive ?? true,
      lines: s
        ? s.lines.map((l) => ({ key: ++seq, componentId: l.componentId, calculation: l.calculation, value: l.value ?? '' }))
        : [
            { key: ++seq, componentId: props.components.find((c) => c.role === 'BASIC' && c.isActive)?.id ?? null, calculation: 'PERCENT_OF_CTC', value: 50 },
            { key: ++seq, componentId: null, calculation: 'BALANCE', value: '' },
          ],
    });
  },
  { immediate: true },
);

const componentOptions = (line: Line) =>
  props.components
    .filter((c) => (c.isActive || c.id === line.componentId) && !form.lines.some((l) => l !== line && l.componentId === c.id))
    .map((c) => ({ value: c.id, label: c.name, description: [c.code, c.role === 'BASIC' ? 'Basic' : c.role === 'HRA' ? 'HRA' : null, c.pfWage ? 'PF wage' : null, c.taxable ? null : 'non-taxable'].filter(Boolean).join(' · ') }));
const calculationOptions = COMPONENT_CALCULATIONS.map((c) => ({ value: c, label: CALCULATION_LABELS[c] }));
const balanceCount = computed(() => form.lines.filter((l) => l.calculation === 'BALANCE').length);
const hasBasic = computed(() => form.lines.some((l) => props.components.find((c) => c.id === l.componentId)?.role === 'BASIC'));
const problems = computed(() => [
  ...(balanceCount.value !== 1 ? ['Exactly one line must be the balance.'] : []),
  ...(!hasBasic.value ? ['Include the Basic component.'] : []),
  ...(form.lines.some((l) => !l.componentId) ? ['Choose a component on every line.'] : []),
  ...(form.lines.some((l) => l.calculation !== 'BALANCE' && (l.value === '' || Number(l.value) < 0)) ? ['Enter a value on every line except the balance.'] : []),
]);

function add() {
  form.lines.splice(Math.max(0, form.lines.length - (form.lines.at(-1)?.calculation === 'BALANCE' ? 1 : 0)), 0, { key: ++seq, componentId: null, calculation: 'FIXED', value: '' });
}
function move(i: number, by: number) {
  const [l] = form.lines.splice(i, 1);
  form.lines.splice(i + by, 0, l!);
}

async function save() {
  reset();
  saving.value = true;
  const body = {
    name: form.name,
    description: form.description || null,
    isActive: form.isActive,
    lines: form.lines.map((l) => ({ componentId: l.componentId!, calculation: l.calculation, value: l.calculation === 'BALANCE' ? null : Number(l.value) })),
  };
  try {
    emit('saved', props.structure ? await payrollApi.updateStructure(props.structure.id, body) : await payrollApi.createStructure(body));
  } catch (e) {
    handle(e, 'Could not save the structure');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="structure ? `Edit ${structure.name}` : 'New salary structure'" description="Lines are worked out top to bottom from the annual CTC; the balance line takes what is left of the gross after employer PF and ESI." size="xl" @close="emit('close')">
    <form id="structure-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="structure?.inUse" tone="info">Employees already on this structure keep their current breakdown; changes apply to salaries set from now on.</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. Standard, Interns" :error="fieldErrors.name" />
        <AppTextarea v-model="form.description" label="Description" :rows="1" :maxlength="300" />
      </div>
      <div>
        <p class="mb-2 text-sm font-medium text-fg">Lines</p>
        <ul class="space-y-2">
          <li v-for="(l, i) in form.lines" :key="l.key" class="grid items-end gap-2 rounded-xl p-3 ring-1 ring-line sm:grid-cols-[1fr_190px_130px_auto]">
            <AppSelect v-model="l.componentId" :label="i === 0 ? 'Component' : undefined" :aria-label="`Component ${i + 1}`" :options="componentOptions(l)" placeholder="Choose" :clearable="false" />
            <AppSelect v-model="l.calculation" :label="i === 0 ? 'Rule' : undefined" :aria-label="`Rule ${i + 1}`" :options="calculationOptions" :clearable="false" />
            <AppInput
              v-model="l.value"
              :label="i === 0 ? 'Value' : undefined"
              :aria-label="`Value ${i + 1}`"
              type="number"
              :min="0"
              :max="l.calculation === 'FIXED' ? undefined : 100"
              :disabled="l.calculation === 'BALANCE'"
              :placeholder="l.calculation === 'BALANCE' ? '—' : l.calculation === 'FIXED' ? '₹ / month' : '%'"
            />
            <div class="flex gap-1">
              <AppButton size="sm" variant="ghost" :icon="ArrowUp" :disabled="i === 0" :aria-label="`Move line ${i + 1} up`" @click="move(i, -1)" />
              <AppButton size="sm" variant="ghost" :icon="ArrowDown" :disabled="i === form.lines.length - 1" :aria-label="`Move line ${i + 1} down`" @click="move(i, 1)" />
              <AppButton size="sm" variant="ghost" :icon="Trash2" :disabled="form.lines.length <= 2" :aria-label="`Remove line ${i + 1}`" @click="form.lines.splice(i, 1)" />
            </div>
          </li>
        </ul>
        <AppButton class="mt-2" size="sm" variant="secondary" :icon="Plus" :disabled="form.lines.length >= 30" @click="add">Add line</AppButton>
        <ul v-if="problems.length" class="mt-3 space-y-0.5 text-xs text-warning-fg">
          <li v-for="p in problems" :key="p">{{ p }}</li>
        </ul>
        <p v-if="fieldErrors.lines" class="error-text" role="alert">{{ fieldErrors.lines }}</p>
      </div>
      <AppCheckbox v-if="structure" v-model="form.isActive" label="Active" description="Inactive structures can't be used for new salaries." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="structure-form" :loading="saving" :disabled="form.name.trim().length < 2 || problems.length > 0">Save structure</AppButton>
    </template>
  </AppModal>
</template>
