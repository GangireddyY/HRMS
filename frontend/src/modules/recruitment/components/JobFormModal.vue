<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { JobDetail, Requisition } from '@/modules/recruitment/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create a job from an approved requisition, or edit a job's posting. */
const props = defineProps<{ open: boolean; job: JobDetail | null; requisition?: Requisition | null }>();
const emit = defineEmits<{ close: []; saved: [job: JobDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const approved = useAsync(() => recruitmentApi.requisitions({ status: 'APPROVED', pageSize: 100 }), { immediate: false });
const form = reactive({ requisitionId: null as string | null, title: '', description: '', requirements: '', experienceMin: '' as number | string, experienceMax: '' as number | string, isPublic: true, closesOn: undefined as string | undefined });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const j = props.job;
    if (!j && !props.requisition) void approved.run();
    Object.assign(form, {
      requisitionId: props.requisition?.id ?? null,
      title: j?.title ?? props.requisition?.title ?? '',
      description: j?.description ?? '',
      requirements: j?.requirements ?? '',
      experienceMin: j?.experienceMin ?? '',
      experienceMax: j?.experienceMax ?? '',
      isPublic: j?.isPublic ?? true,
      closesOn: j?.closesOn ?? undefined,
    });
  },
  { immediate: true },
);
const requisitionOptions = computed(() => (approved.data.value?.items ?? []).filter((r) => !r.job).map((r) => ({ value: r.id, label: `${r.code} · ${r.title}`, description: r.department?.name })));
watch(
  () => form.requisitionId,
  (id) => {
    const r = approved.data.value?.items.find((x) => x.id === id);
    if (r && !form.title) form.title = r.title;
  },
);
const n = (v: number | string) => (v === '' ? null : Number(v));
const canSave = computed(() => (!!props.job || !!form.requisitionId) && form.description.trim().length >= 20);

async function save() {
  reset();
  saving.value = true;
  const body = { title: form.title || undefined, description: form.description, requirements: form.requirements || null, experienceMin: n(form.experienceMin), experienceMax: n(form.experienceMax), isPublic: form.isPublic, closesOn: form.closesOn ?? null };
  try {
    emit('saved', props.job ? await recruitmentApi.updateJob(props.job.id, body) : await recruitmentApi.createJob({ ...body, requisitionId: form.requisitionId! }));
  } catch (e) {
    handle(e, 'Could not save the job');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="job ? 'Edit job posting' : 'Open a job'" size="lg" @close="emit('close')">
    <form id="job-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-if="!job && !requisition" v-model="form.requisitionId" label="Approved requisition" required :options="requisitionOptions" placeholder="Choose a requisition" :clearable="false" help="Jobs are opened from approved requisitions only." :error="fieldErrors.requisitionId" />
      <AppInput v-model="form.title" label="Job title" :error="fieldErrors.title" />
      <AppTextarea v-model="form.description" label="Description" required :rows="6" :maxlength="20000" placeholder="What the role is about and what the person will do" :error="fieldErrors.description" />
      <AppTextarea v-model="form.requirements" label="Requirements" :rows="4" :maxlength="10000" placeholder="Skills, qualifications and experience" />
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="form.experienceMin" label="Experience from (years)" type="number" :min="0" :max="60" :error="fieldErrors.experienceMin" />
        <AppInput v-model="form.experienceMax" label="Experience to (years)" type="number" :min="0" :max="60" :error="fieldErrors.experienceMax" />
        <AppDatePicker v-model="form.closesOn" label="Applications close" />
      </div>
      <AppSwitch v-model="form.isPublic" label="Show on the careers page" description="Anyone can apply with a resume while the job is open." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="job-form" :loading="saving" :disabled="!canSave">{{ job ? 'Save changes' : 'Create job' }}</AppButton>
    </template>
  </AppModal>
</template>
