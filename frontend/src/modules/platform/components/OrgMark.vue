<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiAssetUrl } from '@/core/http/http-client';
import { orgMonogram } from '@/modules/platform/utils/platform-visuals';

/** A tenant's logo, or its monogram on a stable gradient when there is no logo (or it fails to load). */
const props = withDefaults(defineProps<{ name: string; logoUrl?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }>(), { size: 'md', logoUrl: null });
const mark = computed(() => orgMonogram(props.name));
const src = computed(() => apiAssetUrl(props.logoUrl));
const failed = ref(false);
watch(src, () => (failed.value = false));
const SIZES = { sm: 'h-8 w-8 rounded-md text-2xs', md: 'h-9 w-9 rounded-lg text-xs', lg: 'h-12 w-12 rounded-xl text-sm', xl: 'h-16 w-16 rounded-2xl text-lg' };
</script>

<template>
  <span
    :class="['inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white shadow-xs select-none', SIZES[size], src && !failed ? 'bg-surface ring-1 ring-line' : ['bg-gradient-to-br', mark.gradient]]"
    aria-hidden="true"
  >
    <img v-if="src && !failed" :src="src" alt="" class="h-full w-full object-contain p-1" @error="failed = true" />
    <template v-else>{{ mark.initials }}</template>
  </span>
</template>
