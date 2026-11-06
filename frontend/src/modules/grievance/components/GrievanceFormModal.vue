<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { FileUp, ShieldCheck, X } from '@lucide/vue';
import { GRIEVANCE_ATTACHMENT_MAX_BYTES, GRIEVANCE_CATEGORIES, POSH_FILING_MONTHS, type GrievanceCategory } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import type { CaseDetail } from '@/modules/grievance/types';
import { CATEGORY_LABELS, fileSize } from '@/modules/grievance/utils/grievance-format';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Raise a grievance or a POSH complaint, with optional evidence files (uploaded once the case exists). */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [c: CaseDetail, failedFiles: string[]] }>();

const MAX_FILES = 5;
const { fieldErrors, formError, handle, reset } = useFormErrors();
const committee = useAsync(() => grievanceApi.committee(), { immediate: false });
const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = local(new Date());
const form = reactive({
  category: 'WORKPLACE' as GrievanceCategory,
  subject: '',
  description: '',
  respondentId: null as string | null,
  respondentName: '',
  incidentDate: undefined as string | undefined,
  incidentLocation: '',
  witnesses: '',
  delayReason: '',
  interimRelief: '',
  conciliationRequested: false,
});
const files = ref<File[]>([]);
const input = ref<HTMLInputElement | null>(null);
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    files.value = [];
    Object.assign(form, { category: 'WORKPLACE', subject: '', description: '', respondentId: null, respondentName: '', incidentDate: undefined, incidentLocation: '', witnesses: '', delayReason: '', interimRelief: '', conciliationRequested: false });
  },
  { immediate: true },
);
const posh = computed(() => form.category === 'POSH');
watch(posh, (p) => {
  if (p && !committee.data.value) void committee.run();
});
const categoryOptions = GRIEVANCE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
/** POSH complaints are due within 3 months of the incident (section 9); later ones need a reason. */
const late = computed(() => {
  if (!posh.value || !form.incidentDate) return false;
  const limit = new Date();
  limit.setMonth(limit.getMonth() - POSH_FILING_MONTHS);
  return form.incidentDate < local(limit);
});
function pick(e: Event) {
  const list = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  const tooBig = list.filter((f) => f.size > GRIEVANCE_ATTACHMENT_MAX_BYTES);
  fieldErrors.value = { ...fieldErrors.value, file: tooBig.length ? `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 5 MB` : '' };
  files.value = [...files.value, ...list.filter((f) => f.size <= GRIEVANCE_ATTACHMENT_MAX_BYTES)].slice(0, MAX_FILES);
}
const canSave = computed(() => form.subject.trim().length >= 5 && form.description.trim().length >= 20 && (!late.value || form.delayReason.trim().length > 0));

async function save() {
  reset();
  saving.value = true;
  try {
    let c = await grievanceApi.create({
      category: form.category,
      subject: form.subject,
      description: form.description,
      respondentId: form.respondentId,
      respondentName: form.respondentName || null,
      incidentDate: form.incidentDate ?? null,
      incidentLocation: form.incidentLocation || null,
      witnesses: form.witnesses || null,
      delayReason: posh.value ? form.delayReason || null : null,
      interimRelief: posh.value ? form.interimRelief || null : null,
      conciliationRequested: posh.value && form.conciliationRequested,
    });
    const failed: string[] = [];
    for (const f of files.value) {
      try {
        c = await grievanceApi.upload(c.id, f, 'SHARED');
      } catch {
        failed.push(f.name);
      }
    }
    emit('saved', c, failed);
  } catch (e) {
    handle(e, 'Could not submit your case');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Raise a grievance" description="Only the people handling your case can read it." size="lg" @close="emit('close')">
    <form id="grievance-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-model="form.category" label="What is it about?" :options="categoryOptions" :clearable="false" />
      <AppAlert v-if="posh" tone="info" title="Handled only by the Internal Committee">
        <span class="inline-flex items-start gap-2">
          <ShieldCheck :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Complaints of sexual harassment go to the Internal Committee under the POSH Act — HR and administrators can't see them.
            <template v-if="committee.data.value?.length"> Committee: {{ committee.data.value.map((m) => m.name).join(', ') }}.</template>
            <template v-else-if="committee.data.value"> No committee members have been set up yet; your complaint is kept until they are.</template>
          </span>
        </span>
      </AppAlert>
      <AppInput v-model="form.subject" label="Subject" required :maxlength="150" help="A short title. Keep the details for the description." :error="fieldErrors.subject" />
      <AppTextarea v-model="form.description" label="What happened?" required :rows="6" :maxlength="10000" help="Include what happened, when, and how it affected you." :error="fieldErrors.description" />
      <div class="grid gap-4 sm:grid-cols-2">
        <ColleaguePicker v-model:value="form.respondentId" label="Who is it about?" placeholder="A colleague (optional)" :source="grievanceApi.colleagues" />
        <AppInput v-model="form.respondentName" label="Someone outside the company" :maxlength="150" placeholder="e.g. a client or vendor" :error="fieldErrors.respondentName" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.incidentDate" label="When did it happen?" :max="today" :error="fieldErrors.incidentDate" />
        <AppInput v-model="form.incidentLocation" label="Where?" :maxlength="200" />
      </div>
      <AppTextarea v-model="form.witnesses" label="Witnesses" :rows="2" :maxlength="2000" help="Anyone who saw or knows about it (optional)." />
      <div v-if="posh" class="space-y-4 rounded-xl p-4 ring-1 ring-line">
        <AppTextarea
          v-if="late"
          v-model="form.delayReason"
          label="Why is the complaint made now?"
          required
          :rows="2"
          :maxlength="2000"
          help="Complaints are due within 3 months of the incident; the committee can accept a later one when there is a reason."
          :error="fieldErrors.delayReason"
        />
        <AppTextarea v-model="form.interimRelief" label="Support during the inquiry" :rows="2" :maxlength="2000" help="e.g. a transfer, leave, or not reporting to the respondent (section 12). Optional." />
        <AppCheckbox v-model="form.conciliationRequested" label="I'd like the committee to try conciliation first" description="Section 10: an attempt to settle the matter before an inquiry. No monetary settlement can be made." />
      </div>
      <div>
        <p class="label">Evidence</p>
        <button type="button" class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-3 text-left transition hover:border-brand-400" :disabled="files.length >= MAX_FILES" @click="input?.click()">
          <FileUp :size="18" class="text-fg-subtle" aria-hidden="true" />
          <span class="text-sm text-fg-muted">Screenshots, emails or documents — PDF, PNG, JPG or WebP, up to 5 MB each</span>
        </button>
        <input ref="input" type="file" multiple class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Evidence files" @change="pick" />
        <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
        <ul v-if="files.length" class="mt-2 space-y-1">
          <li v-for="(f, i) in files" :key="`${f.name}-${i}`" class="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-sm">
            <span class="min-w-0 truncate text-fg">{{ f.name }} <span class="text-xs text-fg-muted">{{ fileSize(f.size) }}</span></span>
            <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${f.name}`" @click="files.splice(i, 1)"><X :size="14" /></button>
          </li>
        </ul>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="grievance-form" :loading="saving" :disabled="!canSave">Submit</AppButton>
    </template>
  </AppModal>
</template>
