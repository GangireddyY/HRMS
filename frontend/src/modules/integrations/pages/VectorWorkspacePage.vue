<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { AppWindow, Settings2, X } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import VectorOpenCard from '@/modules/integrations/components/VectorOpenCard.vue';
import { useVectorStore } from '@/modules/integrations/vector.store';
import { AppButton, AppEmptyState, AppPageHeader, AppSkeleton } from '@/shared/components';

defineOptions({ name: 'VectorWorkspacePage' });

/** Full-page Vector: open form when allowed; open session survives HRMS navigation until Close. */
const vector = useVectorStore();
const auth = useAuthStore();
const router = useRouter();
const canManage = computed(() => auth.can('integration.manage'));

onMounted(() => {
  if (!vector.loaded) void vector.refresh();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <section v-if="vector.workspace" class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-line" aria-label="Vector workspace">
      <header class="flex h-12 shrink-0 items-center gap-3 border-b border-line/80 px-4">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><AppWindow :size="16" /></span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-fg">{{ vector.workspace.title }}</p>
          <p class="truncate text-2xs text-fg-muted">Inside HRMS · stays open until you close it</p>
        </div>
        <AppButton size="sm" variant="secondary" :icon="X" @click="vector.closeWorkspace()">Close workspace</AppButton>
      </header>
      <iframe
        :src="vector.workspace.url"
        :title="vector.workspace.title"
        class="min-h-0 w-full flex-1 border-0 bg-canvas"
        allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
        allowfullscreen
      />
    </section>

    <template v-else>
      <AppPageHeader title="Vector" :description="vector.orgLabel ? `Open the ${vector.orgLabel} workspace inside HRMS.` : 'Open your connected Vector workspace inside HRMS.'" class="shrink-0" />
      <AppSkeleton v-if="!vector.loaded" :lines="4" />
      <VectorOpenCard v-else-if="vector.available" @open="vector.openWorkspace($event)" />
      <div v-else class="card p-6">
        <AppEmptyState
          :icon="AppWindow"
          :title="canManage ? 'Vector is not connected' : 'Vector is not available'"
          :description="
            canManage
              ? 'Connect Vector under Integrations, choose which roles may open it, then return here.'
              : 'Your administrator has not given your role access to Vector, or it is not connected yet.'
          "
        >
          <AppButton v-if="canManage" size="sm" :icon="Settings2" @click="router.push('/admin/integrations')">Open Integrations</AppButton>
        </AppEmptyState>
      </div>
    </template>
  </div>
</template>
