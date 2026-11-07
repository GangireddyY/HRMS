<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ImageUp, Loader2, Trash2, Upload } from '@lucide/vue';
import { apiAssetUrl, errorMessage } from '@/core/http/http-client';
import { useAuthStore } from '@/core/auth/auth.store';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { AppButton } from '@/shared/components';
import { useLogoAppearance } from '@/shared/composables/use-logo-appearance';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Uploads take effect immediately (separately from the profile form), so unsaved profile edits are untouched. */
const props = defineProps<{ logoUrl: string | null; organizationName: string; disabled?: boolean }>();
const emit = defineEmits<{ changed: [logoUrl: string | null] }>();

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

const auth = useAuthStore();
const feedback = useFeedbackStore();
const current = ref(props.logoUrl);
watch(() => props.logoUrl, (v) => (current.value = v));
const src = computed(() => apiAssetUrl(current.value));
const appearance = useLogoAppearance(src);
const initial = computed(() => props.organizationName.trim().charAt(0).toUpperCase() || '?');

const input = ref<HTMLInputElement | null>(null);
const busy = ref<'upload' | 'remove' | null>(null);
const error = ref<string | null>(null);
const dragging = ref(false);

function pick() {
  if (!props.disabled && !busy.value) input.value?.click();
}

function validate(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Upload a PNG, JPG or WebP image';
  if (file.size > MAX_BYTES) return 'The logo must be 5 MB or smaller';
  return null;
}

async function upload(file: File | undefined) {
  if (!file || props.disabled) return;
  error.value = validate(file);
  if (error.value) return;
  busy.value = 'upload';
  try {
    const { logoUrl } = await organizationApi.uploadLogo(file);
    current.value = logoUrl;
    emit('changed', logoUrl);
    feedback.success('Logo updated');
    await auth.loadContext();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = null;
    if (input.value) input.value.value = '';
  }
}

async function remove() {
  if (!(await feedback.confirm({ title: 'Remove the logo?', message: 'Your organization initial will be shown instead.', confirmLabel: 'Remove logo', danger: true }))) return;
  busy.value = 'remove';
  error.value = null;
  try {
    await organizationApi.removeLogo();
    current.value = null;
    emit('changed', null);
    feedback.success('Logo removed');
    await auth.loadContext();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = null;
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  void upload(e.dataTransfer?.files?.[0]);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-5">
    <button
      type="button"
      :disabled="disabled || !!busy"
      :aria-label="src ? 'Replace logo' : 'Upload logo'"
      :style="src && appearance?.opaque ? { backgroundColor: appearance.edgeColor } : undefined"
      :class="[
        'group relative flex h-24 w-52 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition',
        src ? 'ring-1 ring-line' : 'border-2 border-dashed border-line-strong bg-surface-muted/60',
        src && !appearance?.opaque && 'bg-surface-muted',
        dragging && 'border-brand-500 bg-brand-50 ring-4 ring-brand-500/15 dark:bg-brand-500/10',
        !disabled && 'hover:border-brand-400',
      ]"
      @click="pick"
      @dragover.prevent="!disabled && (dragging = true)"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <img v-if="src" :src="src" :alt="`${organizationName} logo`" class="h-full w-full object-contain px-4 py-3" />
      <span v-else class="flex flex-col items-center gap-1 text-fg-subtle">
        <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-semibold text-white">{{ initial }}</span>
      </span>
      <span v-if="!disabled && !busy" class="absolute inset-0 flex items-center justify-center bg-zinc-950/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <ImageUp :size="22" aria-hidden="true" />
      </span>
      <span v-if="busy" class="absolute inset-0 flex items-center justify-center bg-surface/70">
        <Loader2 :size="22" class="animate-spin text-brand-600" aria-hidden="true" />
      </span>
    </button>

    <div class="min-w-0">
      <div v-if="!disabled" class="flex flex-wrap gap-2">
        <AppButton size="sm" variant="secondary" :icon="Upload" :loading="busy === 'upload'" :disabled="!!busy" @click="pick">{{ src ? 'Replace logo' : 'Upload logo' }}</AppButton>
        <AppButton v-if="src" size="sm" variant="ghost" :icon="Trash2" :loading="busy === 'remove'" :disabled="!!busy" @click="remove">Remove</AppButton>
      </div>
      <p class="mt-2 max-w-md text-xs text-fg-muted">
        PNG, JPG or WebP, up to 5 MB. Empty borders are trimmed and the image is optimized automatically; square and wide logos both work{{ disabled ? '' : '. You can also drop a file on the preview' }}.
      </p>
      <p v-if="src && appearance?.opaque && !disabled" class="mt-2 max-w-md text-xs text-amber-700 dark:text-amber-300">
        This logo has a solid background, so it appears as a badge on dark themes. For the most seamless look, upload a PNG with a transparent background.
      </p>
      <p v-if="error" class="mt-2 text-xs font-medium text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </div>

    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-label="Logo file" @change="upload(($event.target as HTMLInputElement).files?.[0])" />
  </div>
</template>
