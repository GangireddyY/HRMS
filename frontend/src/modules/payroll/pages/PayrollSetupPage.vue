<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Pencil, Plus, Sparkles, Trash2 } from '@lucide/vue';
import { PROFESSIONAL_TAX_STATES } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import ComponentFormModal from '@/modules/payroll/components/ComponentFormModal.vue';
import StructureFormModal from '@/modules/payroll/components/StructureFormModal.vue';
import type { SalaryComponentDef, SalaryStructure } from '@/modules/payroll/types';
import { lineRule } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppEmptyState, AppErrorState, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('payroll.configure'));
const tab = ref('structures');
const tabs = [
  { key: 'structures', label: 'Salary structures' },
  { key: 'components', label: 'Components' },
  { key: 'statutory', label: 'Statutory settings' },
];
const components = useAsync(() => payrollApi.components());
const structures = useAsync(() => payrollApi.structures());

const seeding = ref(false);
async function addStandard() {
  seeding.value = true;
  try {
    const r = await payrollApi.recommended();
    components.data.value = r.components;
    structures.data.value = r.structures;
    feedback.success('Standard structure added', 'Basic 50% of CTC, HRA 50% of Basic, and a special allowance for the rest.');
  } catch (e) {
    feedback.error('Could not add the standard structure', e);
  } finally {
    seeding.value = false;
  }
}

const structureOpen = ref(false);
const editingStructure = ref<SalaryStructure | null>(null);
function openStructure(s: SalaryStructure | null) {
  editingStructure.value = s;
  structureOpen.value = true;
}
async function onStructureSaved() {
  structureOpen.value = false;
  feedback.success('Structure saved');
  await structures.run();
}
async function removeStructure(s: SalaryStructure) {
  if (!(await feedback.confirm({ title: `Delete ${s.name}?`, message: 'The structure is removed. Structures used by employees can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removeStructure(s.id);
    feedback.success('Structure deleted');
    await structures.run();
  } catch (e) {
    feedback.error('Could not delete the structure', e);
  }
}

const componentOpen = ref(false);
const editingComponent = ref<SalaryComponentDef | null>(null);
function openComponent(c: SalaryComponentDef | null) {
  editingComponent.value = c;
  componentOpen.value = true;
}
async function onComponentSaved() {
  componentOpen.value = false;
  feedback.success('Component saved');
  await components.run();
}
async function removeComponent(c: SalaryComponentDef) {
  if (!(await feedback.confirm({ title: `Delete ${c.name}?`, message: 'Components used in a structure can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removeComponent(c.id);
    feedback.success('Component deleted');
    await components.run();
  } catch (e) {
    feedback.error('Could not delete the component', e);
  }
}

// Statutory settings
const settings = useAsync(() => payrollApi.settings());
const { fieldErrors, formError, handle, reset } = useFormErrors();
const s = reactive({ pfEnabled: true, pfRestrictToCeiling: true, esiEnabled: true, ptEnabled: true, ptState: null as string | null, lopFromAttendance: false, pfEstablishmentCode: '', esiEmployerCode: '', tan: '', overtimeMultiplier: 2 as number | string, overtimeBasis: 'GROSS' as 'BASIC' | 'GROSS' });
const overtimeBasisOptions = [
  { value: 'GROSS', label: 'Monthly gross ÷ 26 ÷ 8' },
  { value: 'BASIC', label: 'Monthly Basic ÷ 26 ÷ 8' },
];
watch(
  () => settings.data.value,
  (v) => {
    if (v) Object.assign(s, { ...v, pfEstablishmentCode: v.pfEstablishmentCode ?? '', esiEmployerCode: v.esiEmployerCode ?? '', tan: v.tan ?? '' });
  },
  { immediate: true },
);
const ptOptions = PROFESSIONAL_TAX_STATES.map((p) => ({ value: p.code, label: p.name }));
const savingSettings = ref(false);
async function saveSettings() {
  reset();
  savingSettings.value = true;
  try {
    settings.data.value = await payrollApi.updateSettings({ ...s, overtimeMultiplier: Number(s.overtimeMultiplier), pfEstablishmentCode: s.pfEstablishmentCode || null, esiEmployerCode: s.esiEmployerCode || null, tan: s.tan || null });
    feedback.success('Payroll settings saved');
  } catch (e) {
    handle(e, 'Could not save the settings');
  } finally {
    savingSettings.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Payroll setup" description="Salary components, structures and the statutory rules payroll applies (PF, ESI, professional tax, TDS).">
      <template v-if="canConfigure" #actions>
        <AppButton v-if="tab === 'structures'" :icon="Plus" @click="openStructure(null)">New structure</AppButton>
        <AppButton v-else-if="tab === 'components'" :icon="Plus" @click="openComponent(null)">New component</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <template v-if="tab === 'structures'">
        <AppSkeleton v-if="structures.loading.value && !structures.data.value" :lines="4" />
        <AppErrorState v-else-if="structures.error.value" :error="structures.error.value" @retry="structures.run" />
        <AppCard v-else-if="!structures.data.value?.length">
          <AppEmptyState :icon="Sparkles" title="No salary structures yet" description="Start with the standard structure (Basic 50% of CTC, HRA 50% of Basic, special allowance for the rest) and adjust it, or build your own.">
            <AppButton v-if="canConfigure" :icon="Sparkles" :loading="seeding" @click="addStandard">Add standard structure</AppButton>
          </AppEmptyState>
        </AppCard>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <AppCard v-for="st in structures.data.value" :key="st.id" :title="st.name" :description="st.description ?? undefined">
            <template #actions>
              <AppBadge v-if="!st.isActive">Inactive</AppBadge>
              <AppBadge v-if="st.inUse" tone="info">In use</AppBadge>
              <template v-if="canConfigure">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${st.name}`" @click="openStructure(st)" />
                <AppButton v-if="!st.inUse" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${st.name}`" @click="removeStructure(st)" />
              </template>
            </template>
            <ul class="divide-y divide-line/60 text-sm">
              <li v-for="l in st.lines" :key="l.componentId" class="flex justify-between gap-3 py-2">
                <span class="text-fg">{{ l.component?.name }}</span>
                <span class="text-fg-muted">{{ lineRule(l.calculation, l.value) }}</span>
              </li>
            </ul>
          </AppCard>
        </div>
      </template>

      <template v-else-if="tab === 'components'">
        <AppErrorState v-if="components.error.value" :error="components.error.value" @retry="components.run" />
        <AppCard v-else :padded="false">
          <AppSkeleton v-if="components.loading.value && !components.data.value" class="p-4" :lines="4" />
          <p v-else-if="!components.data.value?.length" class="p-4 text-sm text-fg-muted">No components yet. Adding the standard structure creates Basic, HRA and a special allowance.</p>
          <ul v-else class="divide-y divide-line">
            <li v-for="c in components.data.value" :key="c.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ c.name }} <span class="text-xs font-normal text-fg-subtle">{{ c.code }}</span></p>
                <p v-if="c.description" class="text-xs text-fg-muted">{{ c.description }}</p>
              </div>
              <div class="flex flex-wrap gap-1">
                <AppBadge v-if="c.role" tone="brand" size="sm">{{ c.role === 'BASIC' ? 'Basic' : 'HRA' }}</AppBadge>
                <AppBadge size="sm">{{ c.taxable ? 'Taxable' : 'Non-taxable' }}</AppBadge>
                <AppBadge v-if="c.pfWage" size="sm" tone="info">PF wage</AppBadge>
                <AppBadge v-if="c.esiWage" size="sm" tone="info">ESI wage</AppBadge>
                <AppBadge v-if="!c.isActive" size="sm" tone="warning">Inactive</AppBadge>
              </div>
              <div v-if="canConfigure" class="flex gap-1">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${c.name}`" @click="openComponent(c)" />
                <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${c.name}`" @click="removeComponent(c)" />
              </div>
            </li>
          </ul>
        </AppCard>
      </template>

      <template v-else>
        <AppSkeleton v-if="settings.loading.value && !settings.data.value" :lines="6" />
        <AppErrorState v-else-if="settings.error.value" :error="settings.error.value" @retry="settings.run" />
        <form v-else class="grid items-start gap-4 lg:grid-cols-2" novalidate @submit.prevent="saveSettings">
          <AppAlert v-if="formError" class="lg:col-span-2">{{ formError }}</AppAlert>
          <AppCard title="Provident fund (EPF)" description="12% of PF wages from the employee and the employer; 8.33% of the employer share (on up to ₹15,000) goes to the pension scheme.">
            <div class="space-y-3">
              <AppCheckbox v-model="s.pfEnabled" :disabled="!canConfigure" label="Deduct provident fund" />
              <AppCheckbox v-model="s.pfRestrictToCeiling" :disabled="!canConfigure || !s.pfEnabled" label="Limit contributions to wages of ₹15,000" description="Untick to contribute on the full PF wages." />
              <AppInput v-model="s.pfEstablishmentCode" :disabled="!canConfigure" label="PF establishment code" placeholder="e.g. KNBNG0012345000" :maxlength="30" />
            </div>
          </AppCard>
          <AppCard title="Employee state insurance (ESI)" description="0.75% (employee) and 3.25% (employer) of gross wages for employees earning up to ₹21,000 a month at the start of each contribution period.">
            <div class="space-y-3">
              <AppCheckbox v-model="s.esiEnabled" :disabled="!canConfigure" label="Apply ESI" />
              <AppInput v-model="s.esiEmployerCode" :disabled="!canConfigure" label="ESI employer code" :maxlength="30" />
            </div>
          </AppCard>
          <AppCard title="Professional tax" description="Deducted by the state of each employee's work location; this state applies when the location has none.">
            <div class="space-y-3">
              <AppCheckbox v-model="s.ptEnabled" :disabled="!canConfigure" label="Deduct professional tax" />
              <AppSelect v-model="s.ptState" :disabled="!canConfigure || !s.ptEnabled" label="Default state" :options="ptOptions" :placeholder="settings.data.value?.organizationPtState ? `Organization state (${settings.data.value.organizationState})` : 'None'" :error="fieldErrors.ptState" />
              <p class="text-xs text-fg-muted">Supported: {{ PROFESSIONAL_TAX_STATES.map((p) => p.name).join(', ') }}. States without professional tax (e.g. Delhi) deduct nothing.</p>
            </div>
          </AppCard>
          <AppCard title="Income tax & attendance">
            <div class="space-y-3">
              <AppInput v-model="s.tan" :disabled="!canConfigure" label="TAN" placeholder="BLRA12345B" :maxlength="10" :error="fieldErrors.tan" />
              <AppCheckbox
                v-model="s.lopFromAttendance"
                :disabled="!canConfigure"
                label="Loss of pay from attendance"
                description="Absences and half days count as loss of pay, not just unpaid leave. Payroll then waits for the month's attendance to be closed."
              />
            </div>
          </AppCard>
          <AppCard title="Overtime pay" description="Approved overtime (on shifts that count it) is paid with the next payroll. It is taxable and outside PF and ESI wages.">
            <div class="grid gap-3 sm:grid-cols-2">
              <AppInput v-model="s.overtimeMultiplier" :disabled="!canConfigure" type="number" :min="1" :max="5" :step="0.5" label="Rate" suffix="× hourly" help="The Factories Act sets twice the ordinary rate." :error="fieldErrors.overtimeMultiplier" />
              <AppSelect v-model="s.overtimeBasis" :disabled="!canConfigure" label="Hourly rate" :options="overtimeBasisOptions" :clearable="false" :error="fieldErrors.overtimeBasis" />
            </div>
          </AppCard>
          <div v-if="canConfigure" class="lg:col-span-2">
            <AppButton type="submit" :loading="savingSettings">Save settings</AppButton>
          </div>
        </form>
      </template>
    </AppTabs>

    <StructureFormModal :open="structureOpen" :structure="editingStructure" :components="components.data.value ?? []" @close="structureOpen = false" @saved="onStructureSaved" />
    <ComponentFormModal :open="componentOpen" :component="editingComponent" @close="componentOpen = false" @saved="onComponentSaved" />
  </div>
</template>
