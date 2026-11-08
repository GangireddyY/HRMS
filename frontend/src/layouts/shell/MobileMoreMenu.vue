<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Building2, Check, ChevronRight, LogOut, Moon, Sun } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { accessibleWorkspaces, homePath, visibleSections, type NavItem, type Workspace } from '@/core/navigation/workspaces';
import { useThemeStore } from '@/core/theme/theme.store';
import { AppAvatar } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { useUiStore } from '@/shared/stores/ui.store';

/** "More" on phones and tablets: you, the workspace and organization switch, every page of the workspace, sign out. */
const props = defineProps<{ workspace: Workspace }>();
const ui = useUiStore();
const auth = useAuthStore();
const theme = useThemeStore();
const feedback = useFeedbackStore();
const route = useRoute();
const router = useRouter();
const subject = useAccessSubject();
const panel = ref<HTMLElement | null>(null);

const sections = computed(() => visibleSections(props.workspace, subject.value));
const workspaces = computed(() => accessibleWorkspaces(subject.value).filter((ws) => visibleSections(ws, subject.value).length));
const organizations = computed(() => auth.context?.organizations ?? []);
const displayName = computed(() => (auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : 'User'));
const wsHome = (ws: Workspace) => visibleSections(ws, subject.value)[0]?.items[0]?.to ?? ws.home;
const isActive = (item: NavItem) => (item.exact ? route.path === item.to : route.path === item.to || route.path.startsWith(`${item.to}/`));

async function switchOrg(id: string) {
  if (id === auth.organization?.id) return;
  try {
    await auth.switchOrganization(id);
    await router.push(homePath(subject.value));
    feedback.success(`Switched to ${auth.organization?.name}`);
  } catch (e) {
    feedback.error('Could not switch organization', e);
  }
}
async function signOut() {
  await auth.logout();
  await router.push({ name: 'login' });
}

watch(() => route.fullPath, () => (ui.moreOpen = false));
watch(
  () => ui.moreOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    panel.value?.focus({ preventScroll: true });
  },
);
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.moreOpen && (ui.moreOpen = false);
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const row = 'flex w-full items-center gap-3 border-b border-line/70 px-4 py-3 text-start text-sm last:border-b-0 active:bg-surface-muted';
</script>

<template>
  <div
    v-if="ui.moreOpen"
    id="mobile-more"
    ref="panel"
    tabindex="-1"
    class="absolute inset-0 z-20 animate-fade-in overflow-y-auto bg-canvas bg-ai-wash bg-no-repeat px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none"
  >
    <div class="space-y-4">
      <RouterLink to="/me/profile" class="card flex items-center gap-3 p-4">
        <AppAvatar :name="displayName" :src="auth.user?.avatarUrl" size="lg" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold text-fg">{{ displayName }}</p>
          <p class="truncate text-sm text-fg-muted">{{ auth.user?.email }}</p>
        </div>
        <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
      </RouterLink>

      <section v-if="workspaces.length > 1" class="space-y-2">
        <h2 class="px-1 text-xs font-semibold tracking-wider text-fg-subtle uppercase">Workspaces</h2>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RouterLink
            v-for="ws in workspaces"
            :key="ws.key"
            :to="wsHome(ws)"
            :aria-current="ws.key === workspace.key ? 'true' : undefined"
            :class="['card flex flex-col gap-2 p-3 text-sm font-medium', ws.key === workspace.key ? 'border-brand-400 bg-accent-soft text-accent-fg' : 'text-fg']"
          >
            <component :is="ws.icon" :size="18" aria-hidden="true" />
            {{ ws.label }}
          </RouterLink>
        </div>
      </section>

      <nav class="space-y-4" aria-label="Primary navigation">
        <section v-for="(section, si) in sections" :key="si" class="space-y-2">
          <h2 v-if="section.title" class="px-1 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{{ section.title }}</h2>
          <ul class="card overflow-hidden">
            <li v-for="item in section.items" :key="item.to">
              <RouterLink :to="item.to" :class="[row, isActive(item) && 'bg-accent-soft font-medium text-accent-fg']" :aria-current="isActive(item) ? 'page' : undefined">
                <component :is="item.icon" :size="18" class="shrink-0 text-fg-muted" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                <ChevronRight :size="15" class="text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </section>
      </nav>

      <section v-if="organizations.length > 1" class="space-y-2">
        <h2 class="px-1 text-xs font-semibold tracking-wider text-fg-subtle uppercase">Organizations</h2>
        <div class="card overflow-hidden">
          <button v-for="org in organizations" :key="org.id" type="button" :class="row" :aria-current="org.id === auth.organization?.id ? 'true' : undefined" @click="switchOrg(org.id)">
            <Building2 :size="18" class="shrink-0 text-fg-muted" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ org.name }}</span>
            <Check v-if="org.id === auth.organization?.id" :size="15" class="text-brand-600" aria-hidden="true" />
          </button>
        </div>
      </section>

      <div class="card overflow-hidden">
        <button type="button" :class="row" @click="theme.toggleMode()">
          <component :is="theme.isDark ? Sun : Moon" :size="18" class="shrink-0 text-fg-muted" aria-hidden="true" />
          <span class="flex-1">{{ theme.isDark ? 'Light mode' : 'Dark mode' }}</span>
        </button>
        <button type="button" :class="[row, 'justify-center font-medium text-danger-fg']" @click="signOut">
          <LogOut :size="18" aria-hidden="true" />Sign out
        </button>
      </div>
    </div>
  </div>
</template>
