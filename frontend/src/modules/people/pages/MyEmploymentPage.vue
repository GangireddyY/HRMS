<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FileText, IdCard, UsersRound } from '@lucide/vue';
import { documentsApi, employeesApi, profileApi } from '@/modules/people/api/people.api';
import DocumentsCard from '@/modules/people/components/DocumentsCard.vue';
import MyEmploymentDetails from '@/modules/people/components/MyEmploymentDetails.vue';
import ProfileSectionCard from '@/modules/people/components/ProfileSectionCard.vue';
import { AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';

/** Self-service employee profile: job details, personal details, family, education, work history and documents. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const me = useAsync(() => employeesApi.me());
const canEdit = computed(() => auth.can('self.profile.update'));

/** How many family, education, work history and document entries there are (tab counts and the profile checklist). */
const counts = useAsync(async () => {
  const id = me.data.value?.id;
  if (!id) return null;
  const [family, education, experience, documents] = await Promise.all([
    profileApi.list(id, 'family'),
    profileApi.list(id, 'education'),
    profileApi.list(id, 'experience'),
    documentsApi.list(id),
  ]);
  return { family: family.length, education: education.length, experience: experience.length, documents: documents.length };
}, { immediate: false });
watch(() => me.data.value?.id, (id) => id && void counts.run());

const tab = ref((route.query.tab as string) || 'details');
const tabs = computed(() => [
  { key: 'details', label: 'Details', icon: IdCard },
  { key: 'background', label: 'Family & background', icon: UsersRound, count: counts.data.value ? counts.data.value.family + counts.data.value.education + counts.data.value.experience : null },
  { key: 'documents', label: 'Documents', icon: FileText, count: counts.data.value?.documents ?? null },
]);
watch(tab, (t) => {
  void router.replace({ query: { tab: t === 'details' ? undefined : t } });
  // Coming back to Details after adding entries elsewhere refreshes the checklist.
  if (t === 'details' && me.data.value) void counts.run();
});
</script>

<template>
  <div>
    <AppPageHeader title="My employment" description="Your employee record. Job details are maintained by HR; you keep your personal details, family, education, work history and documents up to date." />
    <AppTabs v-model="tab" :tabs="tabs">
      <AppSkeleton v-if="me.loading.value && !me.data.value" :lines="6" />
      <AppErrorState v-else-if="me.error.value" :error="me.error.value" @retry="me.run" />
      <AppEmptyState v-else-if="!me.data.value" title="No employee record yet" description="HR hasn't linked your account to an employee record. Contact your HR team." />
      <MyEmploymentDetails
        v-else-if="tab === 'details'"
        :employee="me.data.value"
        :can-edit="canEdit"
        :counts="counts.data.value"
        @updated="(e) => (me.data.value = e)"
        @go="(t) => (tab = t)"
      />
      <div v-else-if="tab === 'background'" class="grid items-start gap-4 xl:grid-cols-2">
        <ProfileSectionCard :employee-id="me.data.value.id" section="family" :can-edit="canEdit" />
        <ProfileSectionCard :employee-id="me.data.value.id" section="education" :can-edit="canEdit" />
        <ProfileSectionCard class="xl:col-span-2" :employee-id="me.data.value.id" section="experience" :can-edit="canEdit" :joining-date="me.data.value.dateOfJoining" />
      </div>
      <DocumentsCard v-else :employee-id="me.data.value.id" self-service />
    </AppTabs>
  </div>
</template>
