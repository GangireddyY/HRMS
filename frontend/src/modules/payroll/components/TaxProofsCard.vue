<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Download, FileCheck2, FileText, Paperclip, Trash2, Upload } from '@lucide/vue';
import { TAX_PROOF_SECTION_LABELS, TAX_PROOF_SECTIONS, type TaxProofSection, type TaxProofStatus } from '@contracts';
import { statutoryApi, type TaxProof } from '@/modules/payroll/api/statutory.api';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { rupees } from '@/modules/payroll/utils/payroll-format';

/** Proofs for the declared deductions (what Form 12BB lists), and the year's tax forms. */
const props = defineProps<{ fy: number }>();
const feedback = useFeedbackStore();
const overview = useAsync(() => statutoryApi.myProofs(props.fy), { immediate: false });
const form16 = useAsync(() => statutoryApi.myForm16(props.fy), { immediate: false });
watch(
  () => props.fy,
  () => Promise.all([overview.run(), form16.run()]),
  { immediate: true },
);

const STATUS: Record<TaxProofStatus, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  SUBMITTED: { label: 'Awaiting review', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Not accepted', tone: 'danger' },
};
const sectionOptions = TAX_PROOF_SECTIONS.map((s) => ({ value: s, label: TAX_PROOF_SECTION_LABELS[s] }));
const withDeclared = computed(() => (overview.data.value?.sections ?? []).filter((s) => s.declared > 0 || s.submitted > 0));

const form = reactive({ section: '80C' as TaxProofSection, description: '', amount: '' as string | number });
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const canUpload = computed(() => !!file.value && form.description.trim().length >= 3 && Number(form.amount) > 0);

async function upload() {
  if (!file.value) return;
  reset();
  saving.value = true;
  try {
    await statutoryApi.uploadProof({ fy: props.fy, section: form.section, description: form.description, amount: Number(form.amount) }, file.value);
    feedback.success('Proof submitted', 'Payroll reviews it before the proof cut-off.');
    Object.assign(form, { description: '', amount: '' });
    file.value = null;
    if (input.value) input.value.value = '';
    await overview.run();
  } catch (e) {
    handle(e, 'Could not submit the proof');
  } finally {
    saving.value = false;
  }
}

async function remove(p: TaxProof) {
  if (!(await feedback.confirm({ title: 'Withdraw this proof?', message: p.description, confirmLabel: 'Withdraw', danger: true }))) return;
  try {
    await statutoryApi.removeProof(p.id);
    await overview.run();
  } catch (e) {
    feedback.error('Could not withdraw the proof', e);
  }
}

const open = (fn: () => Promise<void>, what: string) => fn().catch((e) => feedback.error(`Could not open ${what}`, e));
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);
</script>

<template>
  <AppCard title="Proofs & tax forms" :icon="FileCheck2" description="Upload proofs for the deductions you declared. From the proof cut-off, only accepted amounts reduce your tax.">
    <template #actions>
      <AppButton size="sm" variant="secondary" :icon="FileText" @click="open(() => statutoryApi.openForm12bb(fy), 'Form 12BB')">Form 12BB</AppButton>
      <AppButton size="sm" variant="secondary" :icon="Download" :disabled="!form16.data.value" :title="form16.data.value ? undefined : 'Available once a payroll of the year is approved'" @click="open(() => statutoryApi.openForm16(fy), 'Form 16')">
        Form 16
      </AppButton>
    </template>
    <AppSkeleton v-if="overview.loading.value && !overview.data.value" :lines="5" />
    <AppErrorState v-else-if="overview.error.value" :error="overview.error.value" @retry="overview.run" />
    <div v-else-if="overview.data.value" class="space-y-5">
      <AppAlert v-if="overview.data.value.regime === 'NEW'" tone="info">You chose the new regime, so these deductions don't apply and no proofs are needed. Form 16 is still issued.</AppAlert>

      <div v-if="form16.data.value" class="grid gap-3 rounded-xl bg-surface-muted/50 p-3 sm:grid-cols-3">
        <div><p class="text-xs text-fg-muted">Taxable income paid so far</p><p class="font-semibold tabular-nums">{{ rupees(form16.data.value.taxableIncome) }}</p></div>
        <div><p class="text-xs text-fg-muted">Tax on it</p><p class="font-semibold tabular-nums">{{ rupees(form16.data.value.totalTax) }}</p></div>
        <div>
          <p class="text-xs text-fg-muted">Deducted so far</p>
          <p class="font-semibold tabular-nums">{{ rupees(form16.data.value.tdsDeducted) }}</p>
          <p class="text-2xs text-fg-subtle">Monthly TDS follows the projection for the full year</p>
        </div>
      </div>

      <ul v-if="withDeclared.length" class="space-y-3" aria-label="Declared deductions and proofs">
        <li v-for="s in withDeclared" :key="s.section">
          <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span class="font-medium text-fg">{{ s.label }}</span>
            <span class="text-xs text-fg-muted tabular-nums">{{ rupees(s.accepted) }} accepted · {{ rupees(s.submitted) }} submitted · {{ rupees(s.declared) }} declared</span>
          </div>
          <div class="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-fg/10" role="img" :aria-label="`${pct(s.accepted, s.declared)}% of the declared amount accepted`">
            <span class="h-full bg-success" :style="{ width: `${pct(s.accepted, s.declared)}%` }" />
            <span class="h-full bg-warning/70" :style="{ width: `${Math.max(0, pct(s.submitted, s.declared) - pct(s.accepted, s.declared))}%` }" />
          </div>
        </li>
      </ul>

      <form v-if="overview.data.value.regime === 'OLD'" class="space-y-3 rounded-xl border border-line p-3" novalidate @submit.prevent="upload">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-3 sm:grid-cols-[1.4fr_1fr_140px]">
          <AppSelect v-model="form.section" label="Deduction" :options="sectionOptions" :clearable="false" :searchable="false" />
          <AppInput v-model="form.description" label="What it is" placeholder="e.g. PPF deposit, SBI" :maxlength="200" :error="fieldErrors.description" />
          <AppInput v-model="form.amount" label="Amount (₹)" type="number" :min="1" :error="fieldErrors.amount" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-control px-3 py-2 text-sm text-fg-muted hover:border-brand-500 hover:text-fg">
            <Paperclip :size="15" aria-hidden="true" />
            <span class="max-w-56 truncate">{{ file ? file.name : 'Attach the proof (PDF or image, 5 MB)' }}</span>
            <input ref="input" type="file" class="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
          </label>
          <p v-if="fieldErrors.file" class="text-xs text-danger-fg">{{ fieldErrors.file }}</p>
          <AppButton class="ms-auto" type="submit" size="sm" :icon="Upload" :loading="saving" :disabled="!canUpload">Submit proof</AppButton>
        </div>
      </form>

      <ul v-if="overview.data.value.proofs.length" class="divide-y divide-line/70 rounded-xl border border-line" aria-label="Your proofs">
        <li v-for="p in overview.data.value.proofs" :key="p.id" class="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ p.description }}</p>
            <p class="truncate text-xs text-fg-muted">
              {{ p.section }} · {{ rupees(p.amount) }}<template v-if="p.status === 'ACCEPTED' && p.acceptedAmount !== p.amount"> · {{ rupees(p.acceptedAmount ?? 0) }} accepted</template>
              <template v-if="p.reviewNote"> · “{{ p.reviewNote }}”</template>
            </p>
          </div>
          <AppBadge size="sm" :tone="STATUS[p.status].tone" dot>{{ STATUS[p.status].label }}</AppBadge>
          <AppButton size="xs" variant="ghost" :icon="Download" :aria-label="`Download ${p.file.name}`" @click="statutoryApi.downloadProof(p.id, p.file.name)" />
          <AppButton v-if="p.status === 'SUBMITTED'" size="xs" variant="ghost" :icon="Trash2" :aria-label="`Withdraw ${p.description}`" @click="remove(p)" />
        </li>
      </ul>
    </div>
  </AppCard>
</template>
