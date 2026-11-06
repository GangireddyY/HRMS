<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronRight, KeyRound, LogOut, Menu, Moon, Palette, Search, Sun, User } from '@lucide/vue';
import { AppAvatar, AppDropdown, AppMenuItem } from '@/shared/components';
import { visibleSections, type Workspace } from '@/core/navigation/workspaces';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { useUiStore } from '@/shared/stores/ui.store';
import ThemeSwitcher from '@/core/theme/components/ThemeSwitcher.vue';
import { useThemeStore } from '@/core/theme/theme.store';
import NotificationBell from '@/layouts/shell/NotificationBell.vue';

const props = defineProps<{ workspace: Workspace }>();
const auth = useAuthStore();
const ui = useUiStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();
const subject = useAccessSubject();

const displayName = computed(() => (auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : ''));
const workspaceHome = computed(() => visibleSections(props.workspace, subject.value)[0]?.items[0]?.to ?? props.workspace.home);
const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : ''));
const showPage = computed(() => pageTitle.value && route.path !== workspaceHome.value);

const iconButton = 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-muted hover:text-fg';

async function signOut() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md sm:px-5">
    <button type="button" :class="[iconButton, 'lg:hidden']" aria-label="Open navigation" :aria-expanded="ui.mobileNavOpen" @click="ui.mobileNavOpen = true">
      <Menu :size="19" />
    </button>

    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-1.5 text-sm">
      <RouterLink :to="workspaceHome" class="flex min-w-0 items-center gap-2 rounded-md font-medium text-fg-muted transition hover:text-fg">
        <component :is="workspace.icon" :size="15" class="shrink-0" aria-hidden="true" />
        <span :class="showPage ? 'hidden truncate sm:inline' : 'truncate text-fg'">{{ workspace.label }}</span>
      </RouterLink>
      <template v-if="showPage">
        <ChevronRight :size="14" class="hidden shrink-0 text-fg-subtle sm:block" aria-hidden="true" />
        <span class="truncate font-medium text-fg" aria-current="page">{{ pageTitle }}</span>
      </template>
    </nav>

    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="hidden h-9 w-56 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-fg-subtle shadow-xs transition hover:border-line-strong hover:text-fg-muted md:flex lg:w-64"
        aria-label="Open search"
        @click="ui.searchOpen = true"
      >
        <Search :size="15" aria-hidden="true" />
        <span class="truncate">Search…</span>
        <kbd class="ml-auto rounded-md border border-line bg-surface-muted px-1.5 py-px font-sans text-[10px] font-medium text-fg-subtle">Ctrl K</kbd>
      </button>
      <button type="button" :class="[iconButton, 'md:hidden']" aria-label="Search" @click="ui.searchOpen = true">
        <Search :size="18" />
      </button>

      <button
        type="button"
        :class="iconButton"
        :aria-label="theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="theme.isDark ? 'Light mode' : 'Dark mode'"
        @click="theme.toggleMode()"
      >
        <Sun v-if="theme.isDark" :size="18" />
        <Moon v-else :size="18" />
      </button>

      <NotificationBell />

      <div class="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

      <AppDropdown width="w-72" label="Account menu">
        <template #trigger="{ toggle }">
          <button type="button" class="flex items-center gap-2 rounded-full p-0.5 transition hover:ring-4 hover:ring-surface-muted" aria-label="Account menu" @click="toggle">
            <AppAvatar :name="displayName || 'User'" size="sm" />
          </button>
        </template>
        <div class="flex items-center gap-3 px-2.5 pt-1.5 pb-3">
          <AppAvatar :name="displayName || 'User'" size="md" />
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-fg">{{ displayName }}</p>
            <p class="truncate text-xs text-fg-muted">{{ auth.user?.email }}</p>
          </div>
        </div>
        <div class="border-t border-line py-1">
          <AppMenuItem :icon="User" to="/me/profile">My profile</AppMenuItem>
          <AppMenuItem :icon="KeyRound" to="/me/security">Security</AppMenuItem>
          <AppMenuItem :icon="Palette" to="/me/appearance">Appearance</AppMenuItem>
        </div>
        <div class="border-t border-line px-2.5 py-3" @click.stop>
          <ThemeSwitcher variant="compact" />
        </div>
        <div class="border-t border-line pt-1">
          <AppMenuItem :icon="LogOut" danger @select="signOut">Sign out</AppMenuItem>
        </div>
      </AppDropdown>
    </div>
  </header>
</template>
