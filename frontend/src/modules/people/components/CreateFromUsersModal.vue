<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { employeesApi } from '@/modules/people/api/people.api';
import type { LinkableMember } from '@/modules/people/types';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppModal } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Creates employee records for users without one, so they appear in Employees and can use attendance and leave. */
const props = defineProps<{ open: boolean; members: LinkableMember[] }>();
const emit = defineEmits<{ close: []; created: [count: number] }>();

const feedback = useFeedbackStore();
const selected = ref<Set<string>>(new Set());
const saving = ref(false);
watch(
  () => props.open,
  (open) => open && (selected.value = new Set(props.members.map((m) => m.membershipId))),
  { immediate: true },
);
const allSelected = computed(() => props.members.length > 0 && selected.value.size === props.members.length);

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(props.members.map((m) => m.membershipId));
}

async function create() {
  saving.value = true;
  try {
    const res = await employeesApi.createFromMembers([...selected.value]);
    emit('created', res.created);
  } catch (e) {
    feedback.error('Could not create employee records', e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Create employee records" description="Each record uses the person's name, email and joining date. Add department, designation, manager and shift afterwards." size="lg" @close="emit('close')">
    <AppAlert tone="info" class="mb-4">Employee codes are generated automatically (EMP-0001…). Each person can then use attendance and leave.</AppAlert>
    <div class="overflow-hidden rounded-xl ring-1 ring-line">
      <label class="flex cursor-pointer items-center gap-3 border-b border-line bg-surface-muted/60 px-4 py-3 text-sm font-medium text-fg">
        <input type="checkbox" class="h-4 w-4 accent-brand-600" :checked="allSelected" :indeterminate="selected.size > 0 && !allSelected" @change="toggleAll" />
        Select all ({{ members.length }})
      </label>
      <ul class="max-h-80 divide-y divide-line overflow-y-auto">
        <li v-for="m in members" :key="m.membershipId">
          <label class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-muted/50">
            <input type="checkbox" class="h-4 w-4 accent-brand-600" :checked="selected.has(m.membershipId)" :aria-label="`${m.firstName} ${m.lastName}`" @change="toggle(m.membershipId)" />
            <AppAvatar :name="`${m.firstName} ${m.lastName}`" :src="m.avatarUrl" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-fg">{{ m.firstName }} {{ m.lastName }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ m.email }}{{ m.joinedAt ? ` · joined ${formatDate(m.joinedAt)}` : '' }}</span>
            </span>
            <span class="hidden flex-wrap justify-end gap-1 sm:flex">
              <AppBadge v-for="r in m.roles.slice(0, 2)" :key="r" tone="brand" size="sm">{{ r }}</AppBadge>
              <AppBadge v-if="m.status === 'INVITED'" tone="info" size="sm">Invited</AppBadge>
            </span>
          </label>
        </li>
      </ul>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!selected.size" @click="create">Create {{ selected.size }} employee record{{ selected.size === 1 ? '' : 's' }}</AppButton>
    </template>
  </AppModal>
</template>
