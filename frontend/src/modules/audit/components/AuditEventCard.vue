<script setup lang="ts">
import { computed } from 'vue';
import { Building2, ChevronRight } from '@lucide/vue';
import type { AuditEntry } from '@/modules/audit/types';
import { TONE_TILE, auditArea, auditSummary, auditTitle, auditTone } from '@/modules/audit/utils/audit-visuals';
import { AppAvatar } from '@/shared/components';
import { formatDateTime, fullName, timeAgo } from '@/shared/utils/format';

/** One audit event in the grid: what area and action, the readable summary, who did it and when. */
const props = defineProps<{ entry: AuditEntry; showOrganization?: boolean }>();

const area = computed(() => auditArea(props.entry.action));
const tone = computed(() => auditTone(props.entry.action));
const actor = computed(() => (props.entry.actor ? fullName(props.entry.actor) : 'System'));
const changed = computed(() => Object.keys(props.entry.changes ?? {}).length);
const summary = computed(() => auditSummary(props.entry));
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex items-start gap-3">
      <span :class="['grid h-10 w-10 shrink-0 place-items-center rounded-xl', TONE_TILE[tone]]" aria-hidden="true">
        <component :is="area.icon" :size="18" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{{ area.label }}</p>
        <h3 class="truncate text-sm leading-snug font-semibold text-fg" :title="entry.action">{{ auditTitle(entry.action) }}</h3>
      </div>
      <time :datetime="entry.createdAt" :title="formatDateTime(entry.createdAt)" class="shrink-0 pt-0.5 text-xs whitespace-nowrap text-fg-muted">
        {{ timeAgo(entry.createdAt) }}
      </time>
    </div>

    <p class="line-clamp-2 text-sm leading-relaxed text-fg-muted">{{ summary }}</p>

    <p v-if="showOrganization" class="flex items-center gap-1.5 text-xs text-fg-muted">
      <Building2 :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
      <span class="truncate">{{ entry.organization?.name ?? 'Platform' }}</span>
    </p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="actor" size="xs" />
      <span class="min-w-0 truncate text-xs font-medium text-fg">{{ actor }}</span>
      <span v-if="changed" class="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted">
        {{ changed }} {{ changed === 1 ? 'field' : 'fields' }} changed
      </span>
      <span class="ms-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
        Details <ChevronRight :size="13" aria-hidden="true" />
      </span>
    </div>
  </div>
</template>
