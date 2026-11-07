<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle } from '@lucide/vue';
import { WORKSPACES, type WorkspaceKey } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import AppSidebar from '@/layouts/shell/AppSidebar.vue';
import AppTopbar from '@/layouts/shell/AppTopbar.vue';
import MobileMoreMenu from '@/layouts/shell/MobileMoreMenu.vue';
import MobileTabBar from '@/layouts/shell/MobileTabBar.vue';
import MobileTopbar from '@/layouts/shell/MobileTopbar.vue';
import AssistantPanel from '@/modules/assistant/components/AssistantPanel.vue';
import { useDevice } from '@/shared/composables/use-device';
import { openFormPages } from '@/shared/composables/use-form-page';

/**
 * Desktop (≥ 1024px): sidebar, top bar and the page. Phones and tablets: an app layout — a top bar with Back and the
 * page title, the page, and a floating tab bar (key pages, Ask AI, More) that steps aside while a form is open.
 */
const props = defineProps<{ workspace: WorkspaceKey }>();
const auth = useAuthStore();
const ws = computed(() => WORKSPACES.find((w) => w.key === props.workspace)!);
const route = useRoute();
const fill = computed(() => !!route.meta.fill);
const { isDesktop } = useDevice();
const showTabBar = computed(() => !isDesktop.value && openFormPages.value === 0);
</script>

<template>
  <a href="#main" class="sr-only z-50 rounded-lg bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
  <!-- The page panel sits flush against the sidebar, separated by a hairline. -->
  <div class="flex h-dvh overflow-hidden bg-sidebar">
    <AppSidebar v-if="isDesktop" :workspace="ws" />
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas lg:border-l lg:border-line">
        <AppTopbar v-if="isDesktop" :workspace="ws" />
        <MobileTopbar v-else :workspace="ws" />
        <div
          v-if="auth.isRestricted"
          class="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          role="status"
        >
          <AlertTriangle :size="16" class="shrink-0" aria-hidden="true" />
          <span v-if="auth.context?.passwordExpired">Your password has expired. Change it to continue using HRMS.</span>
          <span v-else>Your organization requires two-factor authentication. Set it up to continue.</span>
        </div>
        <!-- Forms open as pages over the content area (AppModal teleports into #form-pages). -->
        <div id="form-pages" class="relative flex min-h-0 flex-1 flex-col">
          <main id="main" :class="['min-h-0 flex-1 overflow-y-auto overscroll-contain', fill && 'lg:overflow-hidden']" tabindex="-1">
            <div
              :class="[
                'bg-ai-wash min-h-full w-full animate-fade-in bg-no-repeat px-3 py-4 sm:px-4 lg:px-4 lg:py-4 2xl:px-8',
                fill && 'lg:h-full lg:py-4',
                showTabBar && 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]',
              ]"
            >
              <slot />
            </div>
          </main>
          <MobileMoreMenu v-if="!isDesktop" :workspace="ws" />
        </div>
      </div>
    </div>
    <MobileTabBar v-if="showTabBar" :workspace="ws" />
    <AssistantPanel />
  </div>
</template>
