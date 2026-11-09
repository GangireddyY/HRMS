<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { CheckCheck, CheckCircle2, Eye, FilePlus2, Flag, History, Lock, MessageSquare, Paperclip, RotateCcw, Search, Undo2, UserCheck } from '@lucide/vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { EVENT_LABELS, STATUS_LABELS } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppSegmented } from '@/shared/components';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** One stream of everything that happened on a case for its handlers: status changes, messages, notes and files, newest first. */
const props = defineProps<{ grievance: CaseDetail }>();

type Kind = 'event' | 'note' | 'file';
interface Item {
  id: string;
  kind: Kind;
  at: string;
  title: string;
  actor: string | null;
  detail: string | null;
  internal: boolean;
  icon: Component;
  tone: string;
}
const EVENT_ICONS: Record<string, Component> = {
  SUBMITTED: FilePlus2,
  ACKNOWLEDGED: Eye,
  ASSIGNED: UserCheck,
  INVESTIGATING: Search,
  PRIORITY: Flag,
  RESOLVED: CheckCircle2,
  REOPENED: RotateCcw,
  ACCEPTED: CheckCheck,
  CLOSED: Lock,
  WITHDRAWN: Undo2,
};
const EVENT_TONES: Record<string, string> = {
  RESOLVED: 'bg-success-soft text-success-fg ring-success/20',
  ACCEPTED: 'bg-success-soft text-success-fg ring-success/20',
  REOPENED: 'bg-warning-soft text-warning-fg ring-warning/25',
  WITHDRAWN: 'bg-surface-muted text-fg-muted ring-line',
  CLOSED: 'bg-surface-muted text-fg-muted ring-line',
};
const BRAND = 'bg-accent-soft text-accent-fg ring-brand-500/20';
const INTERNAL = 'bg-warning-soft text-warning-fg ring-warning/25';

const items = computed<Item[]>(() => {
  const g = props.grievance;
  const handler = g.role === 'HANDLER';
  const out: Item[] = [
    ...g.events.map((e) => ({
      id: `e-${e.id}`,
      kind: 'event' as const,
      at: e.createdAt,
      title: EVENT_LABELS[e.type] ?? e.type,
      actor: e.actor,
      detail: e.detail ?? (e.toStatus ? `Status: ${STATUS_LABELS[e.toStatus]}` : null),
      internal: e.internal,
      icon: EVENT_ICONS[e.type] ?? History,
      tone: e.internal ? INTERNAL : (EVENT_TONES[e.type] ?? BRAND),
    })),
    ...g.notes.map((n) => ({
      id: `n-${n.id}`,
      kind: 'note' as const,
      at: n.createdAt,
      title: n.visibility === 'INTERNAL' ? 'Internal note' : n.fromComplainant && handler ? 'Message from the complainant' : 'Message',
      actor: n.author,
      detail: n.body,
      internal: n.visibility === 'INTERNAL',
      icon: n.visibility === 'INTERNAL' ? Lock : MessageSquare,
      tone: n.visibility === 'INTERNAL' ? INTERNAL : n.fromComplainant ? 'bg-info-soft text-info-fg ring-info/20' : BRAND,
    })),
    ...g.attachments.map((f) => ({
      id: `f-${f.id}`,
      kind: 'file' as const,
      at: f.createdAt,
      title: `File added: ${f.fileName}`,
      actor: f.uploadedBy,
      detail: null,
      internal: f.visibility === 'INTERNAL',
      icon: Paperclip,
      tone: f.visibility === 'INTERNAL' ? INTERNAL : 'bg-surface-muted text-fg-muted ring-line',
    })),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at));
});

const filter = ref<'all' | 'updates' | 'messages'>('all');
const filterOptions = [
  { value: 'all' as const, label: 'All' },
  { value: 'updates' as const, label: 'Updates' },
  { value: 'messages' as const, label: 'Messages & files' },
];
const shown = computed(() => items.value.filter((i) => filter.value === 'all' || (filter.value === 'updates' ? i.kind === 'event' : i.kind !== 'event')));
</script>

<template>
  <section class="card overflow-hidden" aria-labelledby="activity-title">
    <header class="flex min-h-12 flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><History :size="16" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="activity-title" class="text-sm font-semibold text-fg">Case activity</h2>
        <p class="text-xs text-fg-muted">Everything that happened on this case, newest first.</p>
      </div>
      <AppSegmented v-model="filter" :options="filterOptions" size="sm" label="Show" class="w-72 max-sm:w-full" />
    </header>
    <ol v-if="shown.length" class="px-4 py-4">
      <li v-for="(i, idx) in shown" :key="i.id" class="relative flex gap-3 pb-5 last:pb-0">
        <span v-if="idx < shown.length - 1" class="absolute top-8 bottom-0 start-[15px] w-px bg-line" aria-hidden="true" />
        <span :class="['relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', i.tone]" aria-hidden="true">
          <component :is="i.icon" :size="14" />
        </span>
        <div class="min-w-0 flex-1 pt-1">
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span class="font-medium text-fg">{{ i.title }}</span>
            <AppBadge v-if="i.internal" size="sm" tone="warning">Internal</AppBadge>
          </p>
          <p class="text-xs text-fg-subtle">
            <template v-if="i.actor">{{ i.actor }} · </template><time :datetime="i.at" :title="formatDateTime(i.at)">{{ timeAgo(i.at) }}</time>
          </p>
          <p
            v-if="i.detail"
            :class="[
              'mt-1.5 text-sm whitespace-pre-line',
              i.kind === 'note' ? ['line-clamp-4 rounded-md px-3 py-2 ring-1 ring-inset', i.internal ? 'bg-warning-soft/50 text-fg ring-warning/25' : 'bg-surface-muted/60 text-fg ring-line'] : 'text-fg-muted',
            ]"
          >
            {{ i.detail }}
          </p>
        </div>
      </li>
    </ol>
    <p v-else class="px-4 py-6 text-center text-sm text-fg-muted">Nothing to show for this filter.</p>
  </section>
</template>
