<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle } from '@lucide/vue';
import { WORKSPACES, type WorkspaceKey } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import AppSidebar from '@/layouts/shell/AppSidebar.vue';
import AppTopbar from '@/layouts/shell/AppTopbar.vue';
import GlobalSearch from '@/layouts/shell/GlobalSearch.vue';

const props = defineProps<{ workspace: WorkspaceKey }>();
const auth = useAuthStore();
const ws = computed(() => WORKSPACES.find((w) => w.key === props.workspace)!);
const route = useRoute();
const fill = computed(() => !!route.meta.fill);
</script>

<template>
  <a href="#main" class="sr-only z-50 rounded-lg bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
  <!-- The page panel floats on the sidebar color (inset layout on large screens). -->
  <div class="flex h-full overflow-hidden bg-sidebar">
    <AppSidebar :workspace="ws" />
    <div class="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas lg:rounded-2xl lg:border lg:border-line lg:shadow-card">
        <AppTopbar :workspace="ws" />
        <div
          v-if="auth.isRestricted"
          class="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          role="status"
        >
          <AlertTriangle :size="16" class="shrink-0" aria-hidden="true" />
          <span v-if="auth.context?.passwordExpired">Your password has expired. Change it to continue using HRMS.</span>
          <span v-else>Your organization requires two-factor authentication. Set it up to continue.</span>
        </div>
        <main id="main" :class="['min-h-0 flex-1 overflow-y-auto', fill && 'lg:overflow-hidden']" tabindex="-1">
          <div :class="['w-full animate-fade-in px-4 py-7 sm:px-6 lg:px-8 lg:py-8 2xl:px-10', fill && 'lg:h-full lg:py-6']">
            <slot />
          </div>
        </main>
      </div>
    </div>
    <GlobalSearch />
  </div>
</template>
