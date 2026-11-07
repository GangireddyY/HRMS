<script setup lang="ts">
import { computed, useId } from 'vue';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

/** A small trend line with a soft fill, scaled to its own minimum and maximum. Decorative: pair it with the value. */
const props = withDefaults(defineProps<{ values: number[]; tone?: Tone; height?: number }>(), { tone: 'brand', height: 32 });
const id = useId();
const WIDTH = 120;
const TONE: Record<Tone, string> = {
  brand: 'text-brand-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
  info: 'text-sky-500',
};

const paths = computed(() => {
  const v = props.values;
  if (v.length < 2) return null;
  const max = Math.max(...v);
  const min = Math.min(...v);
  const span = max - min || 1;
  const h = props.height;
  const points = v.map((y, i) => [(i / (v.length - 1)) * WIDTH, h - 2 - ((y - min) / span) * (h - 4)] as const);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${WIDTH},${h} L0,${h} Z` };
});
</script>

<template>
  <svg v-if="paths" :viewBox="`0 0 ${WIDTH} ${height}`" preserveAspectRatio="none" :class="['w-full', TONE[tone]]" :style="{ height: `${height}px` }" aria-hidden="true">
    <defs>
      <linearGradient :id="id" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="paths.area" :fill="`url(#${id})`" />
    <path :d="paths.line" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
</template>
