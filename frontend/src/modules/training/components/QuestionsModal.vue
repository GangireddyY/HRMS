<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import { MAX_OPTIONS_PER_QUESTION, MAX_QUESTIONS_PER_COURSE } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import type { CourseDetail, Question } from '@/modules/training/types';
import { AppAlert, AppButton, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Multiple-choice assessment editor: each question has 2–6 options and exactly one correct answer. */
const props = defineProps<{ open: boolean; course: CourseDetail }>();
const emit = defineEmits<{ close: []; saved: [c: CourseDetail] }>();

const { formError, handle, reset } = useFormErrors();
const questions = ref<Question[]>([]);
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    questions.value = (props.course.questions ?? []).map((q) => ({ prompt: q.prompt, options: [...q.options], correctIndex: q.correctIndex }));
    if (!questions.value.length) add();
  },
  { immediate: true },
);
function add() {
  questions.value.push({ prompt: '', options: ['', ''], correctIndex: 0 });
}
function removeOption(q: Question, i: number) {
  q.options.splice(i, 1);
  if (q.correctIndex >= q.options.length) q.correctIndex = 0;
  else if (q.correctIndex > i) q.correctIndex--;
}
const valid = computed(() => questions.value.every((q) => q.prompt.trim().length >= 3 && q.options.length >= 2 && q.options.every((o) => o.trim()) && q.correctIndex < q.options.length));
async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await trainingApi.setQuestions(props.course.id, questions.value));
  } catch (e) {
    handle(e, 'Could not save the questions');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="`Assessment · ${course.code}`" :description="`Pass mark ${course.passMark}% · ${course.maxAttempts} attempt${course.maxAttempts === 1 ? '' : 's'}. Select the correct option for each question.`" size="xl" @close="emit('close')">
    <div class="space-y-4">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <fieldset v-for="(q, qi) in questions" :key="qi" class="rounded-xl p-4 ring-1 ring-line">
        <legend class="sr-only">Question {{ qi + 1 }}</legend>
        <div class="mb-3 flex items-start gap-2">
          <AppTextarea v-model="q.prompt" class="flex-1" :label="`Question ${qi + 1}`" :rows="2" :maxlength="1000" />
          <AppButton class="mt-4" variant="ghost" :icon="Trash2" :aria-label="`Remove question ${qi + 1}`" @click="questions.splice(qi, 1)" />
        </div>
        <ul class="space-y-2">
          <li v-for="(_, oi) in q.options" :key="oi" class="flex items-center gap-2">
            <input v-model="q.correctIndex" type="radio" :name="`correct-${qi}`" :value="oi" class="accent-brand-600" :aria-label="`Option ${oi + 1} is correct`" />
            <AppInput v-model="q.options[oi]" class="flex-1" :aria-label="`Question ${qi + 1} option ${oi + 1}`" :placeholder="`Option ${oi + 1}`" :maxlength="300" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :disabled="q.options.length <= 2" :aria-label="`Remove option ${oi + 1}`" @click="removeOption(q, oi)" />
          </li>
        </ul>
        <AppButton class="mt-2" size="sm" variant="ghost" :icon="Plus" :disabled="q.options.length >= MAX_OPTIONS_PER_QUESTION" @click="q.options.push('')">Add option</AppButton>
      </fieldset>
      <AppButton variant="secondary" :icon="Plus" :disabled="questions.length >= MAX_QUESTIONS_PER_COURSE" @click="add">Add question</AppButton>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!valid || !questions.length" @click="save">Save {{ questions.length }} question{{ questions.length === 1 ? '' : 's' }}</AppButton>
    </template>
  </AppModal>
</template>
