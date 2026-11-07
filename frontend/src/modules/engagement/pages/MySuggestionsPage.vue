<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Lightbulb } from '@lucide/vue';
import { SUGGESTION_CATEGORIES, type SuggestionCategory } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { SUGGESTION_CATEGORY_LABELS, SUGGESTION_STATUS_LABELS, suggestionTone } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppEmptyState, AppInput, AppPageHeader, AppSelect, AppTextarea } from '@/shared/components';
import { employeesApi } from '@/modules/people/api/people.api';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const canSuggest = computed(() => auth.can('engagement.recognition.give') && !!me.data.value);
const table = useTable((q) => engagementApi.suggestions({ ...q, view: 'mine' }));
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ title: '', body: '', category: 'WORKPLACE' as SuggestionCategory, anonymous: false });
const sending = ref(false);
const categoryOptions = SUGGESTION_CATEGORIES.map((c) => ({ value: c, label: SUGGESTION_CATEGORY_LABELS[c] }));
async function submit() {
  reset();
  sending.value = true;
  try {
    await engagementApi.suggest({ ...form });
    feedback.success('Suggestion sent', form.anonymous ? 'It was sent without your name.' : 'You will be notified when it is reviewed.');
    Object.assign(form, { title: '', body: '', anonymous: false });
    await table.load();
  } catch (e) {
    handle(e, 'Could not send the suggestion');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <AppPageHeader title="Suggestions" description="Ideas to make work better. HR reviews every one." back="/me/engagement" back-label="Company" />
    <AppCard v-if="canSuggest" title="New suggestion">
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-[1fr_200px]">
          <AppInput v-model="form.title" label="Idea" required :maxlength="200" :error="fieldErrors.title" />
          <AppSelect v-model="form.category" label="Area" :options="categoryOptions" :clearable="false" />
        </div>
        <AppTextarea v-model="form.body" label="Details" required :rows="4" :maxlength="4000" placeholder="What would you change, and what difference would it make?" :error="fieldErrors.body" />
        <AppCheckbox v-model="form.anonymous" label="Send anonymously" description="Your name isn't stored, so you won't see it in your list or get a reply." />
        <AppButton type="submit" :loading="sending" :disabled="form.title.trim().length < 3 || form.body.trim().length < 10">Send</AppButton>
      </form>
    </AppCard>
    <AppCard title="Your suggestions" :padded="false">
      <AppEmptyState v-if="!table.loading.value && !table.rows.value.length" :icon="Lightbulb" title="No suggestions yet" compact />
      <ul v-else class="divide-y divide-line">
        <li v-for="s in table.rows.value" :key="s.id" class="px-4 py-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-medium text-fg">{{ s.title }}</p>
            <AppBadge :tone="suggestionTone[s.status]" dot>{{ SUGGESTION_STATUS_LABELS[s.status] }}</AppBadge>
          </div>
          <p class="text-xs text-fg-muted">{{ SUGGESTION_CATEGORY_LABELS[s.category] }} · {{ timeAgo(s.createdAt) }}</p>
          <p v-if="s.response" class="mt-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg">{{ s.response }} <span class="text-xs text-fg-muted">— {{ s.respondedBy }}</span></p>
        </li>
      </ul>
    </AppCard>
  </div>
</template>
