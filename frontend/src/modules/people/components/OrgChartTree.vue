<script setup lang="ts">
import { ChevronDown, Loader2 } from '@lucide/vue';
import type { OrgChartNode } from '@/modules/people/types';
import { EMPLOYEE_STATUS_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge } from '@/shared/components';

/**
 * One level of the visual org chart: person cards joined by connector lines (a bar across siblings, a stem up to
 * the manager). A manager's "N reports" pill opens their team below them, recursively.
 */
const props = defineProps<{
  nodes: OrgChartNode[];
  childrenOf: Map<string, OrgChartNode[]>;
  expanded: Set<string>;
  loading: Set<string>;
  focused: string | null;
  root?: boolean;
}>();
const emit = defineEmits<{ toggle: [node: OrgChartNode] }>();

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899'];
function deptColor(name?: string | null): string {
  if (!name) return '#a1a1aa';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
const kids = (id: string) => props.childrenOf.get(id) ?? [];
</script>

<template>
  <ul
    :class="[
      'relative flex justify-center',
      !root && 'pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:border-s-[1.5px] before:border-line-strong',
    ]"
    :role="root ? 'tree' : 'group'"
    :aria-label="root ? 'Org chart' : undefined"
  >
    <li
      v-for="n in nodes"
      :key="n.id"
      role="treeitem"
      :aria-expanded="n.reportCount ? expanded.has(n.id) : undefined"
      :aria-label="n.name"
      :class="[
        'relative flex flex-col items-center px-2.5',
        !root && [
          'pt-6',
          'before:absolute before:top-0 before:right-1/2 before:h-6 before:w-1/2 before:border-t-[1.5px] before:border-line-strong',
          'after:absolute after:top-0 after:left-1/2 after:h-6 after:w-1/2 after:border-s-[1.5px] after:border-t-[1.5px] after:border-line-strong',
          'first:before:border-0 last:after:border-0 last:before:rounded-se-lg last:before:border-e-[1.5px] first:after:rounded-ss-lg',
          'only:pt-0 only:before:hidden only:after:hidden',
        ],
      ]"
    >
      <div
        :id="`org-card-${n.id}`"
        :class="[
          'relative w-56 rounded-lg border bg-surface text-start shadow-card transition-shadow hover:shadow-lift',
          focused === n.id ? 'border-brand-400 ring-2 ring-brand-500/60' : 'border-line',
        ]"
      >
        <span class="absolute inset-x-0 top-0 h-1 rounded-t-lg" :style="{ backgroundColor: deptColor(n.department?.name) }" aria-hidden="true" />
        <div class="flex items-center gap-3 px-3 pt-4 pb-3">
          <AppAvatar :name="n.name" size="md" />
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/hr/employees/${n.id}`" class="block truncate text-sm font-semibold text-fg hover:text-brand-600 dark:hover:text-brand-300" @pointerdown.stop>{{ n.name }}</RouterLink>
            <p class="truncate text-xs text-fg-muted">{{ n.designation?.name ?? n.employeeCode }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 border-t border-line/70 px-3 py-1.5" :class="n.reportCount > 0 && 'pb-3'">
          <span class="inline-flex min-w-0 items-center gap-1.5 text-2xs font-medium text-fg-muted">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: deptColor(n.department?.name) }" aria-hidden="true" />
            <span class="truncate">{{ n.department?.name ?? 'No department' }}</span>
          </span>
          <AppBadge v-if="n.status !== 'ACTIVE'" class="ms-auto" tone="warning" size="sm">{{ EMPLOYEE_STATUS_LABELS[n.status] }}</AppBadge>
        </div>
        <button
          v-if="n.reportCount"
          type="button"
          :class="[
            'absolute -bottom-3 left-1/2 z-10 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border px-2 text-2xs font-semibold whitespace-nowrap shadow-xs transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
            expanded.has(n.id) ? 'border-brand-300 bg-brand-600 text-white dark:border-brand-500' : 'border-line bg-surface text-fg-muted hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-200',
          ]"
          :aria-label="expanded.has(n.id) ? `Hide ${n.name}'s team` : `Show ${n.name}'s team (${n.reportCount})`"
          @pointerdown.stop
          @click="emit('toggle', n)"
        >
          <Loader2 v-if="loading.has(n.id)" class="h-3 w-3 animate-spin" aria-hidden="true" />
          {{ n.reportCount }} {{ n.reportCount === 1 ? 'report' : 'reports' }}
          <ChevronDown v-if="!loading.has(n.id)" :class="['h-3 w-3 transition', expanded.has(n.id) && 'rotate-180']" aria-hidden="true" />
        </button>
      </div>

      <OrgChartTree
        v-if="expanded.has(n.id) && kids(n.id).length"
        class="mt-3"
        :nodes="kids(n.id)"
        :children-of="childrenOf"
        :expanded="expanded"
        :loading="loading"
        :focused="focused"
        @toggle="(x) => emit('toggle', x)"
      />
    </li>
  </ul>
</template>
