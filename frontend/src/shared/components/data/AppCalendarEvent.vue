<script setup lang="ts">
import { computed, type Component } from 'vue';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange' | 'cyan' | 'neutral';

/**
 * An event chip for `AppMonthCalendar`: `fill` is a tinted block with a coloured edge (all-day things such as leave or
 * a holiday), `dot` is a coloured dot and text (timed or minor things), `outline` is dashed (pending, not yet final).
 */
const props = withDefaults(
  defineProps<{
    label: string;
    /** Any CSS colour; wins over `tone`. */
    color?: string;
    tone?: Tone;
    variant?: 'fill' | 'dot' | 'outline';
    time?: string;
    icon?: Component;
  }>(),
  { color: undefined, tone: 'brand', variant: 'fill', time: undefined, icon: undefined },
);

const TONES: Record<Tone, string> = {
  brand: 'var(--brand-500)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger: 'var(--status-danger)',
  info: 'var(--status-info)',
  violet: 'var(--status-special)',
  orange: 'var(--status-caution)',
  cyan: 'var(--status-away)',
  neutral: 'var(--status-neutral)',
};
const c = computed(() => props.color ?? TONES[props.tone]);
const style = computed(() => {
  if (props.variant === 'dot') return {};
  const text = `color-mix(in oklab, ${c.value} 50%, var(--app-text))`;
  if (props.variant === 'outline') return { color: text, border: `1px dashed color-mix(in oklab, ${c.value} 60%, transparent)` };
  return { color: text, backgroundColor: `color-mix(in oklab, ${c.value} 15%, var(--app-surface))`, boxShadow: `inset 2px 0 0 ${c.value}` };
});
</script>

<template>
  <span
    :class="['flex min-w-0 items-center gap-1 rounded-[4px] px-1.5 py-px text-2xs leading-4 font-medium', variant === 'dot' ? 'text-fg-muted' : '']"
    :style="style"
    :title="time ? `${time} ${label}` : label"
  >
    <span v-if="variant === 'dot'" class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: c }" aria-hidden="true" />
    <component :is="icon" v-if="icon" class="h-3 w-3 shrink-0" aria-hidden="true" />
    <span v-if="time" class="shrink-0 tabular-nums opacity-80">{{ time }}</span>
    <span class="truncate">{{ label }}</span>
  </span>
</template>
