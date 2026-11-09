<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarRange, FileUp, ListChecks, Pencil, Plus, Sparkles, Star, Trash2 } from '@lucide/vue';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import TemplateEditorModal from '@/modules/onboarding/components/TemplateEditorModal.vue';
import type { ChecklistTemplate } from '@/modules/onboarding/types';
import { ASSIGNEE_LABELS, offsetLabel } from '@/modules/onboarding/utils/onboarding-format';
import { AppAddTile, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** Reusable onboarding checklists: what each one asks of the joiner, their manager and HR, and when. */
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

const ASSIGNEES = ['EMPLOYEE', 'MANAGER', 'HR'] as const;
const ASSIGNEE_BAR: Record<(typeof ASSIGNEES)[number], string> = { EMPLOYEE: 'bg-brand-500', MANAGER: 'bg-special', HR: 'bg-info' };
const counts = (t: ChecklistTemplate) => ASSIGNEES.map((a) => ({ a, n: t.tasks.filter((x) => x.assignee === a).length })).filter((x) => x.n);
const span = (t: ChecklistTemplate) => {
  if (!t.tasks.length) return null;
  const offsets = t.tasks.map((x) => Number(x.dueOffsetDays) || 0);
  const lo = Math.min(...offsets);
  const hi = Math.max(...offsets);
  return lo === hi ? offsetLabel(lo) : `${offsetLabel(lo)} → ${offsetLabel(hi).toLowerCase()}`;
};
const strip = computed<StripItem[]>(() => {
  const list = templates.data.value ?? [];
  const def = list.find((t) => t.isDefault && t.isActive);
  return [
    { key: 'all', label: 'Checklists', value: list.length, tone: 'brand', hint: `${list.filter((t) => t.isActive).length} active` },
    { key: 'default', label: 'Tasks in the default', value: def ? def.tasks.length : '—', tone: 'success', hint: def ? def.name : 'No default checklist set' },
    { key: 'tasks', label: 'Tasks across checklists', value: list.reduce((s, t) => s + t.tasks.length, 0), tone: 'info', hint: `${list.reduce((s, t) => s + t.tasks.filter((x) => x.isRequired).length, 0)} required` },
    { key: 'docs', label: 'Document requests', value: list.reduce((s, t) => s + t.tasks.filter((x) => x.documentCategory).length, 0), tone: 'warning', hint: 'Uploaded by the joiner' },
  ];
});
</script>

<template>
  <div class="space-y-4">
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
    <template v-else>
      <AppStatStrip :items="strip" label="Checklists summary" />
      <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <li v-for="t in templates.data.value" :key="t.id" :class="['card flex flex-col p-4', !t.isActive && 'opacity-75']">
          <div class="flex items-start gap-3">
            <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', t.isDefault ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-muted']" aria-hidden="true"><ListChecks :size="18" /></span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <p class="truncate font-semibold text-fg">{{ t.name }}</p>
                <AppBadge v-if="t.isDefault" tone="brand" size="sm"><Star :size="10" class="-ms-0.5 fill-current" aria-hidden="true" />Default</AppBadge>
                <AppBadge v-if="!t.isActive" size="sm" dot>Inactive</AppBadge>
              </div>
              <p v-if="t.description" class="mt-0.5 line-clamp-2 text-sm text-fg-muted">{{ t.description }}</p>
            </div>
          </div>

          <div class="mt-4">
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <p class="text-sm font-semibold text-fg tabular-nums">{{ t.tasks.length }} task{{ t.tasks.length === 1 ? '' : 's' }}</p>
              <p class="text-xs text-fg-muted tabular-nums">{{ t.tasks.filter((x) => x.isRequired).length }} required</p>
            </div>
            <div v-if="t.tasks.length" class="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              <span v-for="c in counts(t)" :key="c.a" :class="ASSIGNEE_BAR[c.a]" :style="{ width: `${(c.n / t.tasks.length) * 100}%` }" />
            </div>
            <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
              <li v-for="c in counts(t)" :key="c.a" class="inline-flex items-center gap-1.5">
                <span :class="['h-2 w-2 rounded-full', ASSIGNEE_BAR[c.a]]" aria-hidden="true" />{{ ASSIGNEE_LABELS[c.a] }} <span class="font-medium text-fg tabular-nums">{{ c.n }}</span>
              </li>
            </ul>
          </div>

          <dl class="mt-4 space-y-1.5 border-t border-line/70 pt-3 text-xs">
            <div v-if="span(t)" class="flex items-center gap-2 text-fg-muted">
              <dt class="inline-flex items-center gap-1.5"><CalendarRange :size="13" aria-hidden="true" /><span class="sr-only">Due dates</span></dt>
              <dd class="truncate">{{ span(t) }}</dd>
            </div>
            <div class="flex items-center gap-2 text-fg-muted">
              <dt class="inline-flex items-center gap-1.5"><FileUp :size="13" aria-hidden="true" /><span class="sr-only">Documents</span></dt>
              <dd>{{ t.tasks.filter((x) => x.documentCategory).length }} document upload{{ t.tasks.filter((x) => x.documentCategory).length === 1 ? '' : 's' }} by the joiner</dd>
            </div>
          </dl>

          <div class="mt-auto flex items-center gap-2 pt-4">
            <span class="me-auto text-2xs text-fg-subtle">Updated {{ timeAgo(t.updatedAt) }}</span>
            <template v-if="canManage">
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${t.name}`" @click="remove(t)" />
              <AppButton size="sm" variant="secondary" :icon="Pencil" @click="edit(t)">Edit</AppButton>
            </template>
          </div>
        </li>
        <li v-if="canManage"><AppAddTile class="h-full" title="New checklist" description="For a team, role or location with its own joining steps." @click="edit(null)" /></li>
      </ul>
    </template>

    <TemplateEditorModal :open="editorOpen" :template="editing" @close="editorOpen = false" @saved="onSaved" />
  </div>
</template>
