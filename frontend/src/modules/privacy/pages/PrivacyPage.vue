<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Download, Eraser, ShieldCheck, UserRoundX, Users } from '@lucide/vue';
import { privacyApi, type FormerEmployee } from '@/modules/privacy/api/privacy.api';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useUnsavedGuard } from '@/shared/composables/use-unsaved-guard';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** Personal data under the DPDP Act: retention periods, erasing former employees, data requests and candidate clean-up. */
const feedback = useFeedbackStore();
const overview = useAsync(() => privacyApi.overview());
const form = reactive({ exitedRetentionYears: 8 as number | string, candidateRetentionMonths: 12 as number | string });
watch(
  () => overview.data.value,
  (v) => v && Object.assign(form, { exitedRetentionYears: v.exitedRetentionYears, candidateRetentionMonths: v.candidateRetentionMonths }),
  { immediate: true },
);
const dirty = computed(() => !!overview.data.value && (Number(form.exitedRetentionYears) !== overview.data.value.exitedRetentionYears || Number(form.candidateRetentionMonths) !== overview.data.value.candidateRetentionMonths));
useUnsavedGuard(dirty);
const saving = ref(false);
async function save() {
  saving.value = true;
  try {
    overview.data.value = await privacyApi.updateSettings({ exitedRetentionYears: Number(form.exitedRetentionYears), candidateRetentionMonths: Number(form.candidateRetentionMonths) });
    feedback.success('Retention periods saved');
  } catch (e) {
    feedback.error('Could not save the retention periods', e);
  } finally {
    saving.value = false;
  }
}

const strip = computed<StripItem[]>(() => {
  const v = overview.data.value;
  if (!v) return [];
  const due = v.formerEmployees.filter((e) => e.nextErasure === 'FULL').length;
  return [
    { key: 'former', label: 'Former employees', value: v.formerEmployees.length, tone: 'brand', hint: 'Not yet fully anonymized' },
    { key: 'due', label: 'Past retention', value: due, tone: due ? 'warning' : 'neutral', hint: due ? 'Ready to anonymize' : 'None yet' },
    { key: 'candidates', label: 'Candidates due', value: v.candidatesDue, tone: v.candidatesDue ? 'orange' : 'neutral', hint: v.candidateRetentionMonths ? `After ${v.candidateRetentionMonths} months` : 'Automatic clean-up off' },
  ];
});

const erasing = ref<FormerEmployee | null>(null);
const confirm = ref('');
const busy = ref<string | null>(null);
async function erase() {
  const e = erasing.value;
  if (!e) return;
  busy.value = e.id;
  try {
    const r = await privacyApi.erase(e.id, confirm.value);
    feedback.success(r.erasureLevel === 'FULL' ? 'Record anonymized' : 'Personal details erased', r.erasureLevel === 'FULL' ? `${e.employeeCode} no longer identifies anyone.` : `Statutory records for ${e.employeeCode} are kept until ${e.retainUntil ? formatDate(e.retainUntil) : 'the retention period ends'}.`);
    erasing.value = null;
    confirm.value = '';
    await overview.run();
  } catch (err) {
    feedback.error('Could not erase the record', err);
  } finally {
    busy.value = null;
  }
}
async function exportEmployee(e: FormerEmployee) {
  busy.value = `export-${e.id}`;
  try {
    await privacyApi.exportEmployee(e.id);
  } catch (err) {
    feedback.error('Could not export the data', err);
  } finally {
    busy.value = null;
  }
}
async function purge() {
  busy.value = 'purge';
  try {
    const { anonymized } = await privacyApi.purgeCandidates();
    feedback.success(anonymized ? `${anonymized} candidate${anonymized === 1 ? '' : 's'} anonymized` : 'No candidates are due');
    await overview.run();
  } catch (err) {
    feedback.error('Could not anonymize candidates', err);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Privacy & retention" description="Personal data is kept only as long as needed (India DPDP Act 2023). Former employees' statutory records stay for the retention period; everything else can be erased once they leave." />
    <AppSkeleton v-if="overview.loading.value && !overview.data.value" :lines="6" />
    <AppErrorState v-else-if="overview.error.value" :error="overview.error.value" @retry="overview.run" />
    <template v-else-if="overview.data.value">
      <AppStatStrip :items="strip" label="Personal data" />

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <AppCard title="Retention periods" :icon="ShieldCheck">
          <form class="space-y-4" novalidate @submit.prevent="save">
            <AppInput v-model="form.exitedRetentionYears" type="number" :min="1" :max="30" label="Keep former employees' statutory records for" suffix="years" help="From the exit date. Payroll, PF and income-tax records are usually kept for 8 years." />
            <AppInput v-model="form.candidateRetentionMonths" type="number" :min="0" :max="120" label="Anonymize candidates who weren't hired after" suffix="months" help="Since their last activity; checked every day. 0 turns this off." />
            <div class="flex justify-end"><AppButton type="submit" :loading="saving" :disabled="!dirty">Save</AppButton></div>
          </form>
        </AppCard>

        <AppCard title="Candidates" :icon="Users" description="Rejected or withdrawn candidates with no recent activity: name, contact details, CTC, notes and résumé are removed.">
          <div class="flex flex-wrap items-center gap-3">
            <p class="me-auto text-sm text-fg-muted">
              <span class="font-semibold text-fg tabular-nums">{{ overview.data.value.candidatesDue }}</span> due now<template v-if="overview.data.value.candidatesPurgedAt"> · last run {{ formatDateTime(overview.data.value.candidatesPurgedAt) }}</template>
            </p>
            <AppButton variant="secondary" :icon="Eraser" :loading="busy === 'purge'" :disabled="!overview.data.value.candidatesDue || !!busy" @click="purge">Anonymize now</AppButton>
          </div>
        </AppCard>
      </div>

      <AppCard title="Former employees" :padded="false" description="Erasing removes contact details, family, education, documents, identity documents, bank account and photo, and closes their sign-in. Past the retention period the record is anonymized too.">
        <AppEmptyState v-if="!overview.data.value.formerEmployees.length" :icon="UserRoundX" title="Nothing to erase" description="Former employees appear here until their record is fully anonymized." />
        <ul v-else class="divide-y divide-line/60">
          <li v-for="e in overview.data.value.formerEmployees" :key="e.id" class="flex flex-wrap items-center gap-4 px-5 py-4">
            <AppAvatar :name="e.name" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2">
                <RouterLink :to="`/hr/employees/${e.id}`" class="font-medium text-fg hover:text-accent-fg hover:underline">{{ e.name }}</RouterLink>
                <AppBadge v-if="e.erasureLevel === 'PARTIAL'" tone="neutral" size="sm">Details erased</AppBadge>
                <AppBadge v-if="e.nextErasure === 'FULL'" tone="warning" size="sm" dot>Past retention</AppBadge>
              </p>
              <p class="text-xs text-fg-muted">{{ e.employeeCode }} · left {{ e.exitDate ? formatDate(e.exitDate) : '—' }}<template v-if="e.retainUntil"> · statutory records until {{ formatDate(e.retainUntil) }}</template></p>
            </div>
            <div class="flex gap-2">
              <AppButton size="sm" variant="ghost" :icon="Download" :loading="busy === `export-${e.id}`" :disabled="!!busy" @click="exportEmployee(e)">Export</AppButton>
              <AppButton
                v-if="e.nextErasure === 'FULL' || !e.erasureLevel"
                size="sm"
                :variant="e.nextErasure === 'FULL' ? 'danger' : 'secondary'"
                :icon="Eraser"
                :disabled="!!busy"
                @click="(erasing = e), (confirm = '')"
              >
                {{ e.nextErasure === 'FULL' ? 'Anonymize' : 'Erase details' }}
              </AppButton>
            </div>
          </li>
        </ul>
      </AppCard>
    </template>

    <AppModal :open="!!erasing" :title="erasing?.nextErasure === 'FULL' ? 'Anonymize this record?' : 'Erase personal details?'" :description="erasing ? `${erasing.name} · ${erasing.employeeCode}` : undefined" size="sm" dialog @close="erasing = null">
      <div class="space-y-4">
        <AppAlert tone="warning">
          <template v-if="erasing?.nextErasure === 'FULL'">The name, work email, date of birth, PAN and UAN are removed as well. Payslips stay as anonymous payroll history. This can't be undone.</template>
          <template v-else>Contact details, family, education, documents, Aadhaar, passport, bank account and photo are deleted, and their sign-in is closed. Name, PAN, UAN, salary and payslips stay until {{ erasing?.retainUntil ? formatDate(erasing.retainUntil) : 'the retention period ends' }}. This can't be undone.</template>
        </AppAlert>
        <AppInput v-model="confirm" :label="`Type ${erasing?.employeeCode} to confirm`" autocomplete="off" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="erasing = null">Cancel</AppButton>
        <AppButton variant="danger" :icon="Eraser" :loading="!!busy" :disabled="confirm.trim().toUpperCase() !== erasing?.employeeCode.toUpperCase()" @click="erase">{{ erasing?.nextErasure === 'FULL' ? 'Anonymize' : 'Erase' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
