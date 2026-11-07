<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Briefcase, GraduationCap, Pencil, Plus, Trash2, Users } from '@lucide/vue';
import { profileApi } from '@/modules/people/api/people.api';
import ProfileItemModal from '@/modules/people/components/ProfileItemModal.vue';
import type { Education, Experience, FamilyMember, ProfileSection } from '@/modules/people/types';
import { EDUCATION_LEVEL_LABELS, GENDER_LABELS, RELATIONSHIP_LABELS } from '@/modules/people/utils/labels';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

type Item = FamilyMember | Education | Experience;

/** Family, education or previous-employment list of one employee, with add / edit / remove when allowed. */
const props = defineProps<{ employeeId: string; section: ProfileSection; canEdit: boolean; joiningDate?: string }>();

const feedback = useFeedbackStore();
const items = useAsync(() => profileApi.list(props.employeeId, props.section) as Promise<Item[]>);
watch(() => props.employeeId, () => void items.run());

const META = {
  family: { title: 'Family & dependents', description: 'Spouse, children, parents and other dependents.', icon: Users, add: 'Add family member', empty: 'No family members added' },
  education: { title: 'Education', description: 'Degrees, diplomas and certifications.', icon: GraduationCap, add: 'Add education', empty: 'No education added' },
  experience: { title: 'Previous employment', description: 'Work history before joining.', icon: Briefcase, add: 'Add employment', empty: 'No previous employment added' },
} as const;
const meta = computed(() => META[props.section]);

const modalOpen = ref(false);
const editing = ref<Item | null>(null);
function open(item: Item | null = null) {
  editing.value = item;
  modalOpen.value = true;
}
async function onSaved() {
  modalOpen.value = false;
  feedback.success(editing.value ? 'Changes saved' : 'Added');
  await items.run();
}
async function remove(item: Item) {
  if (!(await feedback.confirm({ title: 'Remove this entry?', message: 'This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return;
  try {
    await profileApi.remove(props.employeeId, props.section, item.id);
    feedback.success('Removed');
    await items.run();
  } catch (e) {
    feedback.error('Could not remove', e);
  }
}

const years = (start: number | null, end: number | null) => (start && end ? `${start} – ${end}` : end ? `Completed ${end}` : start ? `Since ${start}` : null);
const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthYear = (d: string) => monthYearFormat.format(new Date(`${d}T00:00:00Z`));
function duration(e: Experience) {
  const months = Math.max(0, (Number(e.endDate.slice(0, 4)) - Number(e.startDate.slice(0, 4))) * 12 + Number(e.endDate.slice(5, 7)) - Number(e.startDate.slice(5, 7)) + 1);
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y === 1 ? '' : 's'}`, m && `${m} mo`].filter(Boolean).join(' ') || '< 1 mo';
}
</script>

<template>
  <AppCard :title="meta.title" :description="meta.description" :icon="meta.icon">
    <template v-if="canEdit" #actions>
      <AppButton size="sm" variant="secondary" :icon="Plus" @click="open()">{{ meta.add }}</AppButton>
    </template>
    <AppSkeleton v-if="items.loading.value && !items.data.value" :lines="3" />
    <AppErrorState v-else-if="items.error.value" :error="items.error.value" @retry="items.run" />
    <AppEmptyState v-else-if="!items.data.value?.length" compact :icon="meta.icon" :title="meta.empty" />
    <ul v-else class="divide-y divide-line">
      <li v-for="item in items.data.value" :key="item.id" class="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
        <div class="min-w-0 text-sm">
          <template v-if="section === 'family'">
            <p class="font-medium text-fg">
              {{ (item as FamilyMember).name }}
              <AppBadge v-if="(item as FamilyMember).isDependent" tone="info" size="sm" class="ms-2">Dependent</AppBadge>
            </p>
            <p class="text-fg-muted">
              {{ [RELATIONSHIP_LABELS[(item as FamilyMember).relationship], (item as FamilyMember).gender ? GENDER_LABELS[(item as FamilyMember).gender!] : null, (item as FamilyMember).dateOfBirth ? `Born ${formatDate((item as FamilyMember).dateOfBirth!)}` : null, (item as FamilyMember).phone].filter(Boolean).join(' · ') }}
            </p>
          </template>
          <template v-else-if="section === 'education'">
            <p class="font-medium text-fg">{{ (item as Education).qualification }}<span v-if="(item as Education).specialization" class="font-normal text-fg-muted"> · {{ (item as Education).specialization }}</span></p>
            <p class="text-fg-muted">{{ (item as Education).institution }}</p>
            <p class="text-xs text-fg-subtle">{{ [EDUCATION_LEVEL_LABELS[(item as Education).level], years((item as Education).startYear, (item as Education).endYear), (item as Education).score].filter(Boolean).join(' · ') }}</p>
          </template>
          <template v-else>
            <p class="font-medium text-fg">{{ (item as Experience).designation }}</p>
            <p class="text-fg-muted">{{ [(item as Experience).company, (item as Experience).location].filter(Boolean).join(' · ') }}</p>
            <p class="text-xs text-fg-subtle">{{ monthYear((item as Experience).startDate) }} – {{ monthYear((item as Experience).endDate) }} · {{ duration(item as Experience) }}</p>
            <p v-if="(item as Experience).description" class="mt-1 whitespace-pre-line text-fg-muted">{{ (item as Experience).description }}</p>
          </template>
        </div>
        <div v-if="canEdit" class="flex shrink-0 gap-1">
          <AppButton size="sm" variant="ghost" :icon="Pencil" aria-label="Edit" @click="open(item)" />
          <AppButton size="sm" variant="ghost" :icon="Trash2" aria-label="Remove" @click="remove(item)" />
        </div>
      </li>
    </ul>
    <ProfileItemModal :open="modalOpen" :employee-id="employeeId" :section="section" :item="editing" :joining-date="joiningDate" @close="modalOpen = false" @saved="onSaved" />
  </AppCard>
</template>
