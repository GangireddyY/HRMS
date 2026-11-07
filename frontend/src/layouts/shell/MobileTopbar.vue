<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { visibleSections, type Workspace } from '@/core/navigation/workspaces';
import { AppAvatar } from '@/shared/components';
import GlobalSearch from '@/layouts/shell/GlobalSearch.vue';
import NotificationBell from '@/layouts/shell/NotificationBell.vue';

/** Top bar of the phone / tablet layout: Back on inner pages, the page title, search, notifications and you. */
const props = defineProps<{ workspace: Workspace }>();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const subject = useAccessSubject();

const items = computed(() => visibleSections(props.workspace, subject.value).flatMap((s) => s.items));
const current = computed(() => items.value.find((i) => i.to === route.path) ?? null);
/** Pages in the menu are top-level; anything deeper (a record, a sub-page) gets Back. */
const showBack = computed(() => !current.value);
/** Top-level pages show their own heading, so the bar names the workspace; inner pages name what they are. */
const title = computed(() => (current.value ? props.workspace.label : typeof route.meta.title === 'string' ? route.meta.title : props.workspace.label));
const subtitle = computed(() => (current.value ? (auth.organization?.name ?? null) : null));
const home = computed(() => items.value[0]?.to ?? props.workspace.home);
const displayName = computed(() => (auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : 'User'));

function goBack() {
  if (window.history.state?.back) router.back();
  else void router.push(home.value);
}
</script>

<template>
  <header class="glass pt-safe relative z-20 shrink-0 border-b border-line/70">
    <div class="flex h-14 items-center gap-2 px-2">
      <button v-if="showBack" type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg transition active:bg-surface-muted" aria-label="Back" @click="goBack">
        <ChevronLeft :size="22" />
      </button>
      <RouterLink v-else :to="home" class="ms-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white" :aria-label="`${workspace.label} home`">
        <component :is="workspace.icon" :size="16" aria-hidden="true" />
      </RouterLink>
      <div class="ms-1 min-w-0 flex-1 leading-tight">
        <p class="truncate text-base font-semibold text-fg">{{ title }}</p>
        <p v-if="subtitle" class="truncate text-xs text-fg-muted">{{ subtitle }}</p>
      </div>
      <GlobalSearch />
      <NotificationBell />
      <RouterLink to="/me/profile" class="ms-0.5 rounded-full p-0.5" aria-label="Your profile">
        <AppAvatar :name="displayName" :src="auth.user?.avatarUrl" size="sm" />
      </RouterLink>
    </div>
  </header>
</template>
