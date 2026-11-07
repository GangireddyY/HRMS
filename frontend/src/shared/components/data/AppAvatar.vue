<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiAssetUrl } from '@/core/http/http-client';

/** A profile photo (`src`, an API-relative or absolute URL) or, without one or if it fails to load, the initials. */
const props = withDefaults(defineProps<{ name: string; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }>(), { size: 'md', src: null });
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join(''),
);
/** Deterministic gradient per name so the same person always gets the same avatar. */
const palette = [
  'from-indigo-400 to-indigo-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600',
  'from-violet-400 to-purple-600',
  'from-teal-400 to-cyan-600',
  'from-fuchsia-400 to-fuchsia-600',
];
const color = computed(() => palette[[...props.name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length]);
const url = computed(() => apiAssetUrl(props.src));
const failed = ref(false);
watch(url, () => (failed.value = false));
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-surface select-none',
      url && !failed ? 'bg-surface-muted' : ['bg-gradient-to-br', color],
      { xs: 'h-6 w-6 text-[10px]', sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-16 w-16 text-lg' }[size],
    ]"
    aria-hidden="true"
  >
    <img v-if="url && !failed" :src="url" alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" @error="failed = true" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
