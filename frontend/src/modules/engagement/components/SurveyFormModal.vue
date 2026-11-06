<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from '@lucide/vue';
import { MAX_SURVEY_QUESTIONS, SURVEY_QUESTION_TYPES, type SurveyQuestionType } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { SurveyDetail, SurveyQuestion } from '@/modules/engagement/types';
import { QUESTION_TYPE_LABELS } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Survey builder (drafts): questions of four types, anonymity, audience and closing date. */
const props = defineProps<{ open: boolean; survey: SurveyDetail | null }>();
const emit = defineEmits<{ close: []; saved: [s: SurveyDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const form = reactive({ title: '', description: '', anonymous: true, departmentIds: [] as string[], closesOn: undefined as string | undefined, questions: [] as SurveyQuestion[] });
const saving = ref(false);
const locked = computed(() => !!props.survey && props.survey.status !== 'DRAFT');
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (!departments.data.value) void departments.run();
    const s = props.survey;
    Object.assign(form, {
      title: s?.title ?? '',
      description: s?.description ?? '',
      anonymous: s?.anonymous ?? true,
      departmentIds: [...(s?.departmentIds ?? [])],
      closesOn: s?.closesAt ? s.closesAt.slice(0, 10) : undefined,
      questions: s
        ? s.questions.map((q) => ({ type: q.type, prompt: q.prompt, options: [...q.options], required: q.required }))
        : [
            { type: 'RATING', prompt: 'How satisfied are you with your work overall?', options: [], required: true },
            { type: 'NPS', prompt: 'How likely are you to recommend us as a place to work?', options: [], required: true },
            { type: 'TEXT', prompt: 'What one thing would make work better for you?', options: [], required: false },
          ],
    });
  },
  { immediate: true },
);
const typeOptions = SURVEY_QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }));
const pickDepartment = ref<string | null>(null);
watch(pickDepartment, (id) => {
  if (id && !form.departmentIds.includes(id)) form.departmentIds.push(id);
  pickDepartment.value = null;
});
const departmentOptions = computed(() => (departments.data.value ?? []).filter((d) => d.isActive !== false && !form.departmentIds.includes(d.id)).map((d) => ({ value: d.id, label: d.name })));
const departmentName = (id: string) => departments.data.value?.find((d) => d.id === id)?.name ?? '…';
function setType(q: SurveyQuestion, t: SurveyQuestionType) {
  q.type = t;
  if (t === 'CHOICE' && q.options.length < 2) q.options = ['', ''];
}
function move(i: number, by: number) {
  const [q] = form.questions.splice(i, 1);
  form.questions.splice(i + by, 0, q!);
}
const valid = computed(() => form.title.trim().length >= 3 && form.questions.length > 0 && form.questions.every((q) => q.prompt.trim().length >= 3 && (q.type !== 'CHOICE' || q.options.filter((o) => o.trim()).length >= 2)));
async function save() {
  reset();
  saving.value = true;
  const closesAt = form.closesOn ? new Date(`${form.closesOn}T23:59:00`).toISOString() : null;
  const body = locked.value
    ? { title: form.title, description: form.description || null, closesAt }
    : { title: form.title, description: form.description || null, anonymous: form.anonymous, departmentIds: form.departmentIds.length ? form.departmentIds : null, closesAt, questions: form.questions.map((q) => ({ ...q, options: q.type === 'CHOICE' ? q.options.filter((o) => o.trim()) : [] })) };
  try {
    emit('saved', props.survey ? await engagementApi.updateSurvey(props.survey.id, body) : await engagementApi.createSurvey(body as Parameters<typeof engagementApi.createSurvey>[0]));
  } catch (e) {
    handle(e, 'Could not save the survey');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="survey ? `Edit ${survey.title}` : 'New survey'" :description="locked ? 'The survey is open: only the title, description and closing date can change.' : 'Saved as a draft; open it to start collecting answers.'" size="xl" @close="emit('close')">
    <form id="survey-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_200px]">
        <AppInput v-model="form.title" label="Title" required :maxlength="200" :error="fieldErrors.title" />
        <AppDatePicker v-model="form.closesOn" label="Closes on" />
      </div>
      <AppTextarea v-model="form.description" label="Introduction" :rows="2" :maxlength="2000" />
      <fieldset :disabled="locked" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <AppCheckbox v-model="form.anonymous" label="Anonymous" description="Answers are stored without names; results need at least 3 responses." />
          <div>
            <AppSelect v-model="pickDepartment" label="Departments" placeholder="Everyone" :options="departmentOptions" />
            <ul v-if="form.departmentIds.length" class="mt-2 flex flex-wrap gap-2">
              <li v-for="id in form.departmentIds" :key="id" class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pr-1.5 pl-3 text-sm text-fg">
                {{ departmentName(id) }}
                <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${departmentName(id)}`" @click="form.departmentIds = form.departmentIds.filter((x) => x !== id)"><X :size="13" /></button>
              </li>
            </ul>
          </div>
        </div>
        <ol class="space-y-3">
          <li v-for="(q, i) in form.questions" :key="i" class="rounded-xl p-4 ring-1 ring-line">
            <div class="grid items-start gap-2 sm:grid-cols-[1fr_230px_auto]">
              <AppInput v-model="q.prompt" :label="`Question ${i + 1}`" :maxlength="500" />
              <AppSelect :model-value="q.type" :label="`Question ${i + 1} type`" :options="typeOptions" :clearable="false" @update:model-value="(t) => setType(q, t as SurveyQuestionType)" />
              <div class="flex gap-1 pt-6">
                <AppButton size="sm" variant="ghost" :icon="ArrowUp" :disabled="i === 0" :aria-label="`Move question ${i + 1} up`" @click="move(i, -1)" />
                <AppButton size="sm" variant="ghost" :icon="ArrowDown" :disabled="i === form.questions.length - 1" :aria-label="`Move question ${i + 1} down`" @click="move(i, 1)" />
                <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove question ${i + 1}`" @click="form.questions.splice(i, 1)" />
              </div>
            </div>
            <div v-if="q.type === 'CHOICE'" class="mt-3 space-y-2">
              <div v-for="(_, oi) in q.options" :key="oi" class="flex items-center gap-2">
                <AppInput v-model="q.options[oi]" class="flex-1" :aria-label="`Question ${i + 1} option ${oi + 1}`" :placeholder="`Option ${oi + 1}`" :maxlength="200" />
                <AppButton size="sm" variant="ghost" :icon="Trash2" :disabled="q.options.length <= 2" :aria-label="`Remove option ${oi + 1}`" @click="q.options.splice(oi, 1)" />
              </div>
              <AppButton size="sm" variant="ghost" :icon="Plus" :disabled="q.options.length >= 10" @click="q.options.push('')">Add option</AppButton>
            </div>
            <AppCheckbox v-model="q.required" class="mt-3" label="Answer required" />
          </li>
        </ol>
        <AppButton variant="secondary" :icon="Plus" :disabled="form.questions.length >= MAX_SURVEY_QUESTIONS" @click="form.questions.push({ type: 'RATING', prompt: '', options: [], required: true })">Add question</AppButton>
      </fieldset>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="survey-form" :loading="saving" :disabled="!valid">Save</AppButton>
    </template>
  </AppModal>
</template>
