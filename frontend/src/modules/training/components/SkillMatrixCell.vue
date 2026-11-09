<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ArrowDown, BadgeCheck, Check, Plus } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import type { MatrixCell } from '@/modules/training/types';

/** One person × skill as a compact pill: level / need, a status icon, and the level as five segments. */
const props = defineProps<{ cell: MatrixCell; person: string; skill: string }>();
defineEmits<{ open: [] }>();

type CellStatus = 'meets' | 'short' | 'critical' | 'extra' | 'none';
const status = computed<CellStatus>(() => {
  const c = props.cell;
  if (c.required) return c.gap === 0 ? 'meets' : c.gap === 1 ? 'short' : 'critical';
  return c.level ? 'extra' : 'none';
});
const STYLE: Record<Exclude<CellStatus, 'none'>, string> = {
  meets: 'bg-success-soft text-success-fg ring-success/25',
  short: 'bg-warning-soft text-warning-fg ring-warning/30',
  critical: 'bg-danger-soft text-danger-fg ring-danger/25',
  extra: 'bg-accent-soft text-accent-fg ring-brand-500/20',
};
const ICON = { meets: Check, short: ArrowDown, critical: AlertTriangle } as const;
const description = computed(() => {
  const c = props.cell;
  const level = c.level ? `level ${c.level}, ${SKILL_LEVEL_LABELS[c.level]}${c.verifiedLevel ? ' (verified)' : ' (own rating)'}` : 'not rated';
  const need = c.required ? `; role needs ${c.required}, ${SKILL_LEVEL_LABELS[c.required]}` : '';
  const verdict = { meets: '. Meets the role.', short: '. One level short.', critical: `. ${c.gap} levels short.`, extra: '.', none: '.' }[status.value];
  return `${props.person}, ${props.skill}: ${level}${need}${verdict}`;
});
</script>

<template>
  <button
    v-if="status === 'none'"
    type="button"
    class="group/cell mx-auto flex h-10 w-20 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition hover:bg-surface-muted hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    :title="description"
    :aria-label="description"
    @click="$emit('open')"
  >
    <span class="h-1 w-1 rounded-full bg-current opacity-50 group-hover/cell:hidden group-focus-visible/cell:hidden" aria-hidden="true" />
    <Plus :size="14" class="hidden group-hover/cell:block group-focus-visible/cell:block" aria-hidden="true" />
  </button>
  <button
    v-else
    type="button"
    :class="[
      'mx-auto flex h-10 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg ring-1 ring-inset transition hover:-translate-y-px hover:shadow-sm focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none motion-reduce:hover:translate-y-0',
      STYLE[status],
    ]"
    :title="description"
    :aria-label="description"
    @click="$emit('open')"
  >
    <span class="flex items-center gap-1 text-xs leading-none font-semibold tabular-nums" aria-hidden="true">
      {{ cell.level || '–' }}<span v-if="cell.required" class="font-normal opacity-70">/{{ cell.required }}</span>
      <BadgeCheck v-if="cell.verifiedLevel" :size="12" class="shrink-0" />
      <component :is="ICON[status as keyof typeof ICON]" v-else-if="status !== 'extra'" :size="11" class="shrink-0" />
    </span>
    <!-- Filled = the level held; outlined = levels still missing for the role; faint = beyond what's needed. -->
    <span class="flex items-center gap-[3px]" aria-hidden="true">
      <span
        v-for="n in 5"
        :key="n"
        :class="['h-1 w-2.5 rounded-full', n <= cell.level ? 'bg-current' : cell.required && n <= cell.required ? 'ring-1 ring-current/60 ring-inset' : 'bg-current/15']"
      />
    </span>
  </button>
</template>
