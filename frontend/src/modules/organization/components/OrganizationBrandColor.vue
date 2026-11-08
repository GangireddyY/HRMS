<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Pipette, RotateCcw } from '@lucide/vue';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { BRAND_SHADES, contrastWithWhite, generateBrandPalette, parseHex } from '@/core/theme/brand-palette';
import { dominantLogoColor } from '@/core/theme/logo-color';
import { apiAssetUrl } from '@/core/http/http-client';
import { AppButton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const props = defineProps<{ brandColor: string | null; logoUrl: string | null; disabled?: boolean }>();
const emit = defineEmits<{ changed: [brandColor: string | null] }>();
const feedback = useFeedbackStore();

const PRESETS = ['#4f46e5', '#0e7490', '#047857', '#855a2e', '#be185d', '#a21caf', '#c2410c', '#1d4ed8'];

const value = ref(props.brandColor ?? '');
watch(() => props.brandColor, (v) => (value.value = v ?? ''));
const hex = computed(() => {
  const v = value.value.trim().toLowerCase();
  const full = /^#?[0-9a-f]{3}$/.test(v) ? `#${[...v.replace('#', '')].map((c) => c + c).join('')}` : v.startsWith('#') ? v : `#${v}`;
  return /^#[0-9a-f]{6}$/.test(full) ? full : null;
});
const palette = computed(() => (hex.value ? generateBrandPalette(hex.value) : null));
const buttonContrast = computed(() => (palette.value ? contrastWithWhite(parseHex(palette.value['600'])!) : 0));
const adjusted = computed(() => !!palette.value && !!hex.value && palette.value['600'] !== hex.value);
const dirty = computed(() => (hex.value ?? null) !== (props.brandColor ?? null));
const saving = ref(false);
const sampling = ref(false);

async function fromLogo() {
  const src = apiAssetUrl(props.logoUrl);
  if (!src) return;
  sampling.value = true;
  try {
    const found = await dominantLogoColor(src);
    if (found) value.value = found;
    else feedback.info('No clear color in the logo', 'Pick a color instead; black or grey logos have no brand hue to use.');
  } catch {
    feedback.error('Could not read the logo');
  } finally {
    sampling.value = false;
  }
}

async function save(next: string | null) {
  saving.value = true;
  try {
    const org = await organizationApi.update({ brandColor: next });
    emit('changed', org.brandColor);
    feedback.success(next ? 'Brand color saved' : 'Brand color removed', next ? 'Everyone who follows the organization theme sees it now.' : undefined);
  } catch (e) {
    feedback.error('Could not save the brand color', e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <label class="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-line-control" :class="disabled && 'pointer-events-none opacity-60'">
        <span class="absolute inset-0" :style="{ backgroundColor: hex ?? 'transparent' }" />
        <input v-model="value" type="color" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Pick brand color" :disabled="disabled" />
      </label>
      <input
        v-model="value"
        type="text"
        class="input-base w-32 font-mono uppercase"
        placeholder="#0E7490"
        maxlength="7"
        spellcheck="false"
        aria-label="Brand color hex code"
        :aria-invalid="value.trim() !== '' && !hex"
        :disabled="disabled"
      />
      <AppButton v-if="logoUrl" variant="secondary" size="sm" :icon="Pipette" :loading="sampling" :disabled="disabled" @click="fromLogo">Use logo color</AppButton>
      <div class="flex items-center gap-1.5" role="radiogroup" aria-label="Suggested colors">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          role="radio"
          :aria-checked="hex === p"
          :aria-label="p"
          :disabled="disabled"
          class="flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition hover:scale-110 disabled:opacity-50"
          :class="hex === p && 'ring-2 ring-fg/40'"
          :style="{ backgroundColor: p }"
          @click="value = p"
        >
          <Check v-if="hex === p" :size="12" class="text-white" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="value.trim() !== '' && !hex" class="error-text" role="alert">Enter a hex color such as #0E7490.</p>

    <div v-if="palette" class="space-y-3">
      <div class="flex overflow-hidden rounded-md ring-1 ring-line" aria-label="Generated palette" role="img">
        <span v-for="s in BRAND_SHADES" :key="s" class="h-8 flex-1" :style="{ backgroundColor: palette[s] }" :title="`${s} ${palette[s]}`" />
      </div>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-white shadow-xs" :style="{ backgroundColor: palette['600'] }">Primary action</span>
        <span class="inline-flex h-6 items-center rounded-full px-2 text-xs font-medium" :style="{ backgroundColor: palette['50'], color: palette['700'] }">Selected</span>
        <span class="text-fg-muted">
          White text {{ buttonContrast.toFixed(1) }}:1 <span class="font-medium text-success-fg">· meets WCAG AA</span>
          <template v-if="adjusted"> · darkened slightly for buttons so text stays readable</template>
        </span>
      </div>
    </div>

    <div v-if="!disabled" class="flex flex-wrap items-center gap-2">
      <AppButton size="sm" :disabled="!dirty || !hex" :loading="saving" @click="save(hex)">Save brand color</AppButton>
      <AppButton v-if="brandColor" size="sm" variant="ghost" :icon="RotateCcw" :disabled="saving" @click="save(null)">Remove</AppButton>
    </div>
  </div>
</template>
