<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { ArrowUpRight } from '@lucide/vue';
import { generateBrandPalette, paletteVars } from '@/core/theme/brand-palette';
import { apiAssetUrl } from '@/core/http/http-client';
import type { CareersOrganization } from '@/modules/recruitment/types';

/**
 * Frame of the public careers pages: the employer's logo, name and website, in the employer's brand color (not the
 * visitor's theme). The palette is set on the document root while the page is open and the previous one put back on
 * leave, because the app's color tokens resolve from the root.
 */
const props = defineProps<{ organization: CareersOrganization | null; slug: string }>();

const root = document.documentElement;
const saved = new Map<string, string>();
function applyBrand(color: string | null | undefined) {
  const palette = color ? generateBrandPalette(color) : null;
  if (!palette) return;
  for (const [k, v] of Object.entries(paletteVars(palette))) {
    if (!saved.has(k)) saved.set(k, root.style.getPropertyValue(k));
    root.style.setProperty(k, v);
  }
}
watch(() => props.organization?.brandColor, applyBrand, { immediate: true });
onBeforeUnmount(() => {
  for (const [k, v] of saved) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
});

const logo = computed(() => apiAssetUrl(props.organization?.logoUrl ?? null));
const website = computed(() => {
  const w = props.organization?.website;
  if (!w) return null;
  const href = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return { href, label: w.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
});
const initials = computed(() => (props.organization?.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(''));
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-canvas">
    <header class="sticky top-0 z-30 border-b border-line/70 bg-surface/85 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <RouterLink :to="`/careers/${slug}`" class="flex min-w-0 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none">
          <img v-if="logo" :src="logo" alt="" class="h-9 w-9 shrink-0 rounded-lg object-contain ring-1 ring-line" />
          <span v-else-if="organization" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-semibold text-white" aria-hidden="true">{{ initials }}</span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold text-fg">{{ organization?.name ?? 'Careers' }}</span>
            <span class="block text-2xs font-medium tracking-wide text-fg-subtle uppercase">Careers</span>
          </span>
        </RouterLink>
        <a v-if="website" :href="website.href" target="_blank" rel="noopener noreferrer" class="ms-auto inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-surface-muted hover:text-fg">
          <span class="max-sm:hidden">{{ website.label }}</span><span class="sm:hidden">Website</span>
          <ArrowUpRight :size="14" aria-hidden="true" />
        </a>
      </div>
    </header>

    <main class="flex-1"><slot /></main>

    <footer class="border-t border-line/70 bg-surface">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-fg-subtle sm:px-6">
        <p>© {{ new Date().getFullYear() }} {{ organization?.name }}</p>
        <p>Your application goes straight to the {{ organization?.name ?? 'hiring' }} team.</p>
      </div>
    </footer>
  </div>
</template>
