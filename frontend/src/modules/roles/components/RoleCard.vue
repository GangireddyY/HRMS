<script setup lang="ts">
import { computed } from 'vue';
import { appLocale } from '@/core/locale/locale';
import { ChevronRight, KeyRound, Lock, Users } from '@lucide/vue';
import type { RoleSummary } from '@/modules/roles/types';
import { roleVisual } from '@/modules/roles/utils/role-visuals';
import { AppBadge } from '@/shared/components';
import { timeAgo } from '@/shared/utils/format';

/** A role in the Roles grid: icon, name, description, and how many users and permissions it has. */
const props = defineProps<{ role: RoleSummary }>();
const look = computed(() => roleVisual(props.role.key));
const num = (n: number) => n.toLocaleString(appLocale());
</script>

<template>
  <RouterLink
    :to="`/admin/roles/${role.id}`"
    class="group card card-interactive flex h-full flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none"
  >
    <div :class="['h-1 bg-gradient-to-r', look.strip]" aria-hidden="true" />
    <div class="flex flex-1 flex-col p-4">
      <div class="flex items-start gap-3">
        <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', look.tile]" aria-hidden="true">
          <component :is="look.icon" :size="20" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-1.5 font-semibold text-fg group-hover:text-accent-fg">
            <span class="truncate">{{ role.name }}</span>
            <Lock v-if="role.isLocked" :size="13" class="shrink-0 text-fg-subtle" aria-label="Locked" />
          </p>
          <AppBadge class="mt-1" size="sm" :tone="role.isSystem ? 'neutral' : 'info'">{{ role.isSystem ? 'System' : 'Custom' }}</AppBadge>
        </div>
      </div>

      <p class="mt-3 line-clamp-2 min-h-10 text-sm text-fg-muted">{{ role.description || 'No description yet.' }}</p>

      <dl class="mt-4 grid grid-cols-2 gap-2">
        <div class="rounded-md bg-surface-muted/70 px-3 py-2">
          <dt class="flex items-center gap-1 text-2xs font-medium text-fg-muted"><Users :size="12" aria-hidden="true" />Users</dt>
          <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ num(role.memberCount) }}</dd>
        </div>
        <div class="rounded-md bg-surface-muted/70 px-3 py-2">
          <dt class="flex items-center gap-1 text-2xs font-medium text-fg-muted"><KeyRound :size="12" aria-hidden="true" />Permissions</dt>
          <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ num(role.permissionCount) }}</dd>
        </div>
      </dl>

      <div class="mt-auto pt-4">
        <div class="flex items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted">
          <span class="truncate">Updated {{ timeAgo(role.updatedAt) }}</span>
          <span class="inline-flex shrink-0 items-center gap-0.5 font-semibold text-accent-fg">
            Manage <ChevronRight :size="14" class="transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  </RouterLink>
</template>
