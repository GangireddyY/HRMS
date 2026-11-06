<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { COURSE_CATEGORIES, COURSE_DELIVERIES, type CourseCategory, type CourseDelivery } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import type { CourseDetail } from '@/modules/training/types';
import { CATEGORY_LABELS, DELIVERY_LABELS } from '@/modules/training/utils/training-format';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit a course. Delivery and the assessment setting are fixed once published. */
const props = defineProps<{ open: boolean; course: CourseDetail | null }>();
const emit = defineEmits<{ close: []; saved: [c: CourseDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const published = computed(() => !!props.course && props.course.status !== 'DRAFT');
const form = reactive({
  code: '',
  title: '',
  description: '',
  category: 'TECHNICAL' as CourseCategory,
  delivery: 'SELF_PACED' as CourseDelivery,
  durationHours: '' as number | string,
  provider: '',
  contentUrl: '',
  selfEnrollment: true,
  mandatory: false,
  hasAssessment: false,
  passMark: 70 as number | string,
  maxAttempts: 3 as number | string,
  validityMonths: '' as number | string,
});
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const c = props.course;
    Object.assign(form, {
      code: c?.code ?? '',
      title: c?.title ?? '',
      description: c?.description ?? '',
      category: c?.category ?? 'TECHNICAL',
      delivery: c?.delivery ?? 'SELF_PACED',
      durationHours: c?.durationHours ?? '',
      provider: c?.provider ?? '',
      contentUrl: c?.contentUrl ?? '',
      selfEnrollment: c?.selfEnrollment ?? true,
      mandatory: c?.mandatory ?? false,
      hasAssessment: c?.hasAssessment ?? false,
      passMark: c?.passMark ?? 70,
      maxAttempts: c?.maxAttempts ?? 3,
      validityMonths: c?.validityMonths ?? '',
    });
  },
  { immediate: true },
);
const categoryOptions = COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const deliveryOptions = COURSE_DELIVERIES.map((d) => ({ value: d, label: DELIVERY_LABELS[d] }));
const n = (v: number | string) => (v === '' ? null : Number(v));
const canSave = computed(() => form.code.trim().length >= 2 && form.title.trim().length >= 3);

async function save() {
  reset();
  saving.value = true;
  const body = {
    code: form.code,
    title: form.title,
    description: form.description || null,
    category: form.category,
    delivery: form.delivery,
    durationHours: n(form.durationHours),
    provider: form.provider || null,
    contentUrl: form.contentUrl || null,
    selfEnrollment: form.selfEnrollment,
    mandatory: form.mandatory,
    hasAssessment: form.hasAssessment,
    passMark: Number(form.passMark) || 70,
    maxAttempts: Number(form.maxAttempts) || 3,
    validityMonths: n(form.validityMonths),
  };
  try {
    emit('saved', props.course ? await trainingApi.updateCourse(props.course.id, body) : await trainingApi.createCourse(body));
  } catch (e) {
    handle(e, 'Could not save the course');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="course ? `Edit ${course.code}` : 'New course'" size="lg" @close="emit('close')">
    <form id="course-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[160px_1fr]">
        <AppInput v-model="form.code" label="Code" required :maxlength="20" placeholder="POSH-101" :error="fieldErrors.code" />
        <AppInput v-model="form.title" label="Title" required :maxlength="150" :error="fieldErrors.title" />
      </div>
      <AppTextarea v-model="form.description" label="Description" :rows="3" :maxlength="10000" placeholder="What learners will be able to do afterwards" />
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect v-model="form.category" label="Category" :options="categoryOptions" :clearable="false" />
        <AppSelect v-model="form.delivery" label="Delivery" :options="deliveryOptions" :clearable="false" :disabled="published" />
        <AppInput v-model="form.durationHours" label="Duration (hours)" type="number" :min="0.5" :max="1000" :error="fieldErrors.durationHours" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.provider" label="Provider" :maxlength="120" placeholder="Internal, or the vendor's name" />
        <AppInput v-model="form.contentUrl" label="Content link" :maxlength="500" placeholder="Link to the learning material" :help="form.delivery === 'SELF_PACED' ? 'Where learners take the course.' : 'Pre-reading (optional).'" :error="fieldErrors.contentUrl" />
      </div>
      <div class="space-y-3">
        <AppCheckbox v-model="form.selfEnrollment" label="Open for self-enrolment" description="Employees can join from the catalog; otherwise it's assigned by managers or HR." />
        <AppCheckbox v-model="form.mandatory" label="Mandatory" description="Highlighted in the catalog; assign it to the people who must take it." />
        <AppCheckbox v-model="form.hasAssessment" :disabled="published" label="Assessment" description="Learners must pass a multiple-choice test to complete the course." />
      </div>
      <div v-if="form.hasAssessment" class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.passMark" label="Pass mark (%)" type="number" :min="1" :max="100" :error="fieldErrors.passMark" />
        <AppInput v-model="form.maxAttempts" label="Attempts allowed" type="number" :min="1" :max="20" :error="fieldErrors.maxAttempts" />
      </div>
      <AppInput v-model="form.validityMonths" class="max-w-xs" label="Certificate valid for (months)" type="number" :min="1" :max="120" help="Leave empty if it never expires." :error="fieldErrors.validityMonths" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="course-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
