<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle } from '@lucide/vue';
import { WORKSPACES, type WorkspaceKey } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import AppSidebar from '@/layouts/shell/AppSidebar.vue';
import AppTopbar from '@/layouts/shell/AppTopbar.vue';
const props = defineProps<{ workspace: WorkspaceKey }>();
const auth = useAuthStore();
const ws = computed(() => WORKSPACES.find((w) => w.key === props.workspace)!);
const route = useRoute();
const fill = computed(() => !!route.meta.fill);
</script>

<template>
  <a href="#main" class="sr-only z-50 rounded-lg bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
  <!-- The page panel sits flush against the sidebar, separated by a hairline. -->
  <div class="flex h-full overflow-hidden bg-sidebar">
    <AppSidebar :workspace="ws" />
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas lg:border-l lg:border-line">
        <AppTopbar :workspace="ws" />
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
          <main id="main" :class="['min-h-0 flex-1 overflow-y-auto', fill && 'lg:overflow-hidden']" tabindex="-1">
            <div :class="['w-full animate-fade-in px-3 py-4 sm:px-4 lg:px-4 lg:py-4 2xl:px-8', fill && 'lg:h-full lg:py-4']">
              <slot />
            </div>
          </main>
        </div>
      </div>
    </div>
  </div>
</template>
