<script setup lang="ts">
import { computed, ref } from 'vue';
import { ListChecks, Pencil, Plus, Sparkles, Trash2 } from '@lucide/vue';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import TemplateEditorModal from '@/modules/onboarding/components/TemplateEditorModal.vue';
import type { ChecklistTemplate } from '@/modules/onboarding/types';
import { ASSIGNEE_LABELS } from '@/modules/onboarding/utils/onboarding-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('onboarding.manage'));
const templates = useAsync(() => onboardingApi.templates());

const adding = ref(false);
async function addRecommended() {
  adding.value = true;
  try {
    await onboardingApi.addRecommended();
    feedback.success('Standard checklist added', 'Review the tasks and due dates to match how you onboard people.');
    await templates.run();
  } catch (e) {
    feedback.error('Could not add the checklist', e);
  } finally {
    adding.value = false;
  }
}

const editorOpen = ref(false);
const editing = ref<ChecklistTemplate | null>(null);
function edit(t: ChecklistTemplate | null) {
  editing.value = t;
  editorOpen.value = true;
}
async function onSaved() {
  editorOpen.value = false;
  feedback.success(editing.value ? 'Checklist saved' : 'Checklist created');
  await templates.run();
}
async function remove(t: ChecklistTemplate) {
  if (!(await feedback.confirm({ title: `Delete "${t.name}"?`, message: 'Onboarding already started from it keeps its tasks.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await onboardingApi.removeTemplate(t.id);
    feedback.success('Checklist deleted');
    await templates.run();
  } catch (e) {
    feedback.error('Could not delete the checklist', e);
  }
}
const counts = (t: ChecklistTemplate) => (['EMPLOYEE', 'MANAGER', 'HR'] as const).map((a) => ({ a, n: t.tasks.filter((x) => x.assignee === a).length })).filter((x) => x.n);
</script>

<template>
  <div>
    <AppPageHeader title="Onboarding checklists" description="Reusable task lists. Starting onboarding copies a checklist and sets due dates from the joining date." back="/hr/onboarding" back-label="Onboarding">
      <template v-if="canManage" #actions>
        <AppButton v-if="templates.data.value && !templates.data.value.some((t) => t.name === 'Standard onboarding')" variant="secondary" :icon="Sparkles" :loading="adding" @click="addRecommended">Add standard checklist</AppButton>
        <AppButton :icon="Plus" @click="edit(null)">New checklist</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="templates.loading.value && !templates.data.value" :lines="4" />
    <AppErrorState v-else-if="templates.error.value" :error="templates.error.value" @retry="templates.run" />
    <AppCard v-else-if="!templates.data.value?.length">
      <AppEmptyState :icon="ListChecks" title="No checklists yet" description="Start with the standard checklist (documents, accounts, introductions, 30-day check-in) and adapt it.">
        <AppButton v-if="canManage" :icon="Sparkles" :loading="adding" @click="addRecommended">Add standard checklist</AppButton>
      </AppEmptyState>
    </AppCard>
    <ul v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <li v-for="t in templates.data.value" :key="t.id" class="flex flex-col rounded-2xl bg-surface p-5 ring-1 ring-line">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-semibold text-fg">{{ t.name }}</p>
            <p v-if="t.description" class="mt-0.5 line-clamp-2 text-sm text-fg-muted">{{ t.description }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <AppBadge v-if="t.isDefault" tone="brand" size="sm">Default</AppBadge>
            <AppBadge v-if="!t.isActive" size="sm">Inactive</AppBadge>
          </div>
        </div>
        <p class="mt-4 text-sm text-fg">{{ t.tasks.length }} task{{ t.tasks.length === 1 ? '' : 's' }}</p>
        <p class="mt-1 text-xs text-fg-muted">{{ counts(t).map((c) => `${c.n} ${ASSIGNEE_LABELS[c.a].toLowerCase()}`).join(' · ') }} · {{ t.tasks.filter((x) => x.documentCategory).length }} documents</p>
        <div v-if="canManage" class="mt-4 flex gap-2 border-t border-line/70 pt-4">
          <AppButton size="sm" variant="secondary" :icon="Pencil" @click="edit(t)">Edit</AppButton>
          <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${t.name}`" @click="remove(t)" />
        </div>
      </li>
    </ul>

    <TemplateEditorModal :open="editorOpen" :template="editing" @close="editorOpen = false" @saved="onSaved" />
  </div>
</template>
