<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AlertTriangle, FileText, ScanText } from '@lucide/vue';
import { CANDIDATE_SOURCES, type CandidateSource } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { Candidate } from '@/modules/recruitment/types';
import { SOURCE_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Add a candidate (optionally straight into a job) with live duplicate checks, or edit one. */
const props = defineProps<{ open: boolean; candidate: Candidate | null; jobId?: string | null }>();
const emit = defineEmits<{ close: []; saved: [c: Candidate]; existing: [candidateId: string] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const feedback = useFeedbackStore();
const saving = ref(false);
const blank = () => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  currentCompany: '',
  currentTitle: '',
  experienceYears: '' as number | string,
  currentCtc: '' as number | string,
  expectedCtc: '' as number | string,
  noticePeriodDays: '' as number | string,
  location: '',
  linkedinUrl: '',
  source: 'DIRECT' as CandidateSource,
  notes: '',
  skills: '',
});
const draft = reactive(blank());
// New candidates can be filled in from their resume; only empty fields are filled and the file is attached on save.
const fileInput = ref<HTMLInputElement | null>(null);
const resumeFile = ref<File | null>(null);
const reading = ref(false);
const resumeNote = ref<{ tone: 'info' | 'warning'; text: string } | null>(null);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    duplicates.value = [];
    resumeFile.value = null;
    resumeNote.value = null;
    const c = props.candidate;
    Object.assign(draft, blank(), c ? { ...c, phone: c.phone ?? '', currentCompany: c.currentCompany ?? '', currentTitle: c.currentTitle ?? '', experienceYears: c.experienceYears ?? '', currentCtc: c.currentCtc ?? '', expectedCtc: c.expectedCtc ?? '', noticePeriodDays: c.noticePeriodDays ?? '', location: c.location ?? '', linkedinUrl: c.linkedinUrl ?? '', notes: c.notes ?? '', skills: c.skills.join(', ') } : {});
  },
  { immediate: true },
);

async function onResume(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  reading.value = true;
  resumeNote.value = null;
  try {
    const { parsed, readable } = await recruitmentApi.parseResume(file);
    resumeFile.value = file;
    const filled: string[] = [];
    const fill = <K extends Exclude<keyof typeof draft, 'source'>>(key: K, value: (typeof draft)[K] | undefined, label: string) => {
      if (value === undefined || value === '' || draft[key] !== '') return;
      draft[key] = value;
      if (!filled.includes(label)) filled.push(label);
    };
    fill('firstName', parsed.firstName, 'name');
    fill('lastName', parsed.lastName, 'name');
    fill('email', parsed.email, 'email');
    fill('phone', parsed.phone, 'phone');
    fill('currentTitle', parsed.currentTitle, 'title');
    fill('currentCompany', parsed.currentCompany, 'company');
    fill('experienceYears', parsed.experienceYears, 'experience');
    fill('noticePeriodDays', parsed.noticePeriodDays, 'notice period');
    fill('location', parsed.location, 'location');
    fill('linkedinUrl', parsed.linkedinUrl, 'LinkedIn');
    fill('skills', parsed.skills.join(', '), 'skills');
    resumeNote.value = !readable
      ? { tone: 'warning', text: "No text could be read from this resume (it may be a scanned image). It will still be attached; fill in the details yourself." }
      : filled.length
        ? { tone: 'info', text: `Filled in ${filled.join(', ')} from the resume — check them before saving.` }
        : { tone: 'info', text: 'Nothing was found for the empty fields. The resume will be attached.' };
  } catch (err) {
    handle(err, 'Could not read the resume');
  } finally {
    reading.value = false;
  }
}
const skillList = () => draft.skills.split(',').map((s) => s.trim()).filter(Boolean);

const duplicates = ref<{ id: string; name: string; email: string; match: 'EMAIL' | 'PHONE' }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [draft.email, draft.phone],
  () => {
    clearTimeout(timer);
    if (props.candidate) return;
    timer = setTimeout(async () => {
      if (!draft.email.includes('@') && draft.phone.replace(/\D/g, '').length < 7) return (duplicates.value = []);
      try {
        duplicates.value = await recruitmentApi.duplicates(draft.email || undefined, draft.phone || undefined);
      } catch {
        duplicates.value = [];
      }
    }, 400);
  },
);
const emailTaken = computed(() => duplicates.value.find((d) => d.match === 'EMAIL'));
const sourceOptions = CANDIDATE_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
const n = (v: number | string) => (v === '' ? null : Number(v));
const canSave = computed(() => !!draft.firstName.trim() && !!draft.lastName.trim() && draft.email.includes('@') && !emailTaken.value);

async function save() {
  reset();
  saving.value = true;
  const body = {
    ...draft,
    phone: draft.phone || null,
    currentCompany: draft.currentCompany || null,
    currentTitle: draft.currentTitle || null,
    location: draft.location || null,
    linkedinUrl: draft.linkedinUrl || null,
    notes: draft.notes || null,
    experienceYears: n(draft.experienceYears),
    currentCtc: n(draft.currentCtc),
    expectedCtc: n(draft.expectedCtc),
    noticePeriodDays: n(draft.noticePeriodDays),
    skills: skillList(),
  };
  try {
    if (props.candidate) return emit('saved', await recruitmentApi.updateCandidate(props.candidate.id, body));
    let created = await recruitmentApi.createCandidate({ ...body, jobId: props.jobId ?? null });
    if (resumeFile.value) {
      try {
        created = await recruitmentApi.uploadResume(created.id, resumeFile.value);
      } catch (e) {
        feedback.error('The candidate was added but the resume could not be attached', e);
      }
    }
    emit('saved', created);
  } catch (e) {
    handle(e, 'Could not save the candidate');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="candidate ? `Edit ${candidate.name}` : 'Add candidate'" size="lg" @close="emit('close')">
    <form id="candidate-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div v-if="!candidate" class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted/60 px-4 py-3">
        <p class="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
          <FileText :size="16" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ resumeFile ? resumeFile.name : 'Have their resume? Fill the form from it (PDF or .docx).' }}</span>
        </p>
        <AppButton size="sm" variant="secondary" :icon="ScanText" :loading="reading" @click="fileInput?.click()">{{ resumeFile ? 'Use another resume' : 'Fill from resume' }}</AppButton>
        <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx" aria-label="Resume file" @change="onResume" />
      </div>
      <AppAlert v-if="resumeNote" :tone="resumeNote.tone">{{ resumeNote.text }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="draft.firstName" label="First name" required :error="fieldErrors.firstName" />
        <AppInput v-model="draft.lastName" label="Last name" required :error="fieldErrors.lastName" />
        <AppInput v-model="draft.email" label="Email" type="email" required :error="fieldErrors.email" />
        <AppInput v-model="draft.phone" label="Phone" type="tel" :error="fieldErrors.phone" />
      </div>
      <div v-if="duplicates.length" class="rounded-xl bg-amber-500/10 p-3 text-sm ring-1 ring-amber-500/30">
        <p class="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200"><AlertTriangle :size="15" aria-hidden="true" />{{ emailTaken ? 'This person is already in your candidate database' : 'Possible duplicate' }}</p>
        <ul class="mt-1.5 space-y-1">
          <li v-for="d in duplicates" :key="d.id" class="flex flex-wrap items-center justify-between gap-2 text-fg-muted">
            <span>{{ d.name }} · {{ d.email }} <span class="text-xs">(same {{ d.match === 'EMAIL' ? 'email' : 'phone' }})</span></span>
            <AppButton size="xs" variant="secondary" @click="emit('existing', d.id)">{{ jobId ? 'Add them to this job' : 'Open' }}</AppButton>
          </li>
        </ul>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="draft.currentTitle" label="Current title" />
        <AppInput v-model="draft.currentCompany" label="Current company" />
        <AppInput v-model="draft.experienceYears" label="Experience (years)" type="number" :min="0" :max="60" :step="0.5" :error="fieldErrors.experienceYears" />
        <AppInput v-model="draft.currentCtc" label="Current CTC" type="number" :min="0" :error="fieldErrors.currentCtc" />
        <AppInput v-model="draft.expectedCtc" label="Expected CTC" type="number" :min="0" :error="fieldErrors.expectedCtc" />
        <AppInput v-model="draft.noticePeriodDays" label="Notice period (days)" type="number" :min="0" :max="365" :error="fieldErrors.noticePeriodDays" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="draft.location" label="Location" />
        <AppInput v-model="draft.linkedinUrl" class="sm:col-span-2" label="LinkedIn profile" placeholder="linkedin.com/in/name" :error="fieldErrors.linkedinUrl" />
      </div>
      <AppInput v-model="draft.skills" label="Skills" placeholder="TypeScript, Figma, Negotiation" help="Separate with commas" :error="fieldErrors.skills" />
      <AppSelect v-model="draft.source" class="max-w-xs" label="Source" :options="sourceOptions" :clearable="false" />
      <AppTextarea v-model="draft.notes" label="Notes" :rows="2" :maxlength="2000" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="candidate-form" :loading="saving" :disabled="!canSave">{{ candidate ? 'Save changes' : jobId ? 'Add to job' : 'Add candidate' }}</AppButton>
    </template>
  </AppModal>
</template>
