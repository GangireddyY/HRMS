<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, ShieldCheck } from '@lucide/vue';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { AppAlert, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDateTime } from '@/shared/utils/format';

const route = useRoute();
const id = computed(() => String(route.params.id));
const survey = useAsync(() => engagementApi.survey(id.value));
watch(id, () => void survey.run());
const s = computed(() => survey.data.value);
const answers = reactive<Record<string, number | string>>({});
const { formError, handle, reset } = useFormErrors();
const sending = ref(false);
const complete = computed(() => !!s.value && s.value.questions.every((q) => !q.required || (answers[q.id] !== undefined && String(answers[q.id]).trim() !== '')));
async function submit() {
  reset();
  sending.value = true;
  try {
    const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => String(v).trim() !== ''));
    survey.data.value = await engagementApi.respond(id.value, clean);
  } catch (e) {
    handle(e, 'Could not send your answers');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <AppSkeleton v-if="survey.loading.value && !s" :lines="8" />
    <AppErrorState v-else-if="survey.error.value" :error="survey.error.value" title="This survey isn't available" @retry="survey.run" />
    <template v-else-if="s">
      <AppPageHeader :title="s.title" :description="s.description ?? undefined" back="/me/engagement" back-label="Company" />
      <AppAlert v-if="s.anonymous" tone="info" class="mb-6" title="Anonymous">
        <span class="inline-flex items-start gap-2"><ShieldCheck :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />Your answers are stored without your name, and results are only shown once at least three people have answered.</span>
      </AppAlert>
      <AppCard v-if="s.responded">
        <div class="flex flex-col items-center py-8 text-center">
          <CheckCircle2 :size="40" class="text-emerald-500" aria-hidden="true" />
          <p class="mt-3 text-lg font-semibold text-fg">Thanks for your answers</p>
          <p class="mt-1 text-sm text-fg-muted">You can only answer once.</p>
        </div>
      </AppCard>
      <AppCard v-else-if="!s.permissions.respond"><p class="text-sm text-fg-muted">This survey is closed.</p></AppCard>
      <form v-else class="space-y-6" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppCard v-for="(q, i) in s.questions" :key="q.id">
          <fieldset>
            <legend class="mb-3 text-sm font-medium text-fg">{{ i + 1 }}. {{ q.prompt }}<span v-if="q.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span></legend>
            <div v-if="q.type === 'RATING' || q.type === 'NPS'" class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="q.prompt">
              <button
                v-for="n in q.type === 'RATING' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="answers[q.id] === n"
                class="h-10 min-w-10 rounded-lg px-2 text-sm font-semibold tabular-nums ring-1 transition"
                :class="answers[q.id] === n ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-fg-muted ring-line hover:ring-brand-400'"
                @click="answers[q.id] = n"
              >
                {{ n }}
              </button>
              <p class="mt-1 w-full text-xs text-fg-subtle">{{ q.type === 'RATING' ? '1 = very poor, 5 = excellent' : '0 = not at all likely, 10 = extremely likely' }}</p>
            </div>
            <div v-else-if="q.type === 'CHOICE'" class="space-y-1.5">
              <label v-for="(o, oi) in q.options" :key="oi" class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
                <input v-model="answers[q.id]" type="radio" :name="q.id" :value="oi" class="accent-brand-600" />
                {{ o }}
              </label>
            </div>
            <AppTextarea v-else v-model="(answers[q.id] as string)" :aria-label="q.prompt" :rows="3" :maxlength="2000" />
          </fieldset>
        </AppCard>
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-fg-muted">{{ s.closesAt ? `Closes ${formatDateTime(s.closesAt)}` : '' }}</p>
          <AppButton type="submit" size="lg" :loading="sending" :disabled="!complete">Send answers</AppButton>
        </div>
      </form>
    </template>
  </div>
</template>
