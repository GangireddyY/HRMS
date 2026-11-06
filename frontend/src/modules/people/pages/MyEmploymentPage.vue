<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { employeesApi } from '@/modules/people/api/people.api';
import DocumentsCard from '@/modules/people/components/DocumentsCard.vue';
import MyEmploymentCard from '@/modules/people/components/MyEmploymentCard.vue';
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

const tab = ref((route.query.tab as string) || 'details');
const tabs = [
  { key: 'details', label: 'Details' },
  { key: 'background', label: 'Family & background' },
  { key: 'documents', label: 'Documents' },
];
watch(tab, (t) => void router.replace({ query: { tab: t === 'details' ? undefined : t } }));
</script>

<template>
  <div>
    <AppPageHeader title="My employment" description="Your employee record. Job details are maintained by HR; you keep your personal details, family, education, work history and documents up to date." />
    <AppTabs v-model="tab" :tabs="tabs">
      <MyEmploymentCard v-if="tab === 'details'" />
      <AppSkeleton v-else-if="me.loading.value && !me.data.value" :lines="6" />
      <AppErrorState v-else-if="me.error.value" :error="me.error.value" @retry="me.run" />
      <AppEmptyState v-else-if="!me.data.value" title="No employee record yet" description="HR hasn't linked your account to an employee record. Contact your HR team." />
      <div v-else-if="tab === 'background'" class="grid items-start gap-6 xl:grid-cols-2">
        <ProfileSectionCard :employee-id="me.data.value.id" section="family" :can-edit="canEdit" />
        <ProfileSectionCard :employee-id="me.data.value.id" section="education" :can-edit="canEdit" />
        <ProfileSectionCard class="xl:col-span-2" :employee-id="me.data.value.id" section="experience" :can-edit="canEdit" :joining-date="me.data.value.dateOfJoining" />
      </div>
      <DocumentsCard v-else :employee-id="me.data.value.id" self-service />
    </AppTabs>
  </div>
</template>
