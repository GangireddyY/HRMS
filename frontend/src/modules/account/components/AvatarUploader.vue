<script setup lang="ts">
import { computed, ref } from 'vue';
import { Camera, Loader2, Trash2, Upload } from '@lucide/vue';
import { errorMessage } from '@/core/http/http-client';
import { useAuthStore } from '@/core/auth/auth.store';
import { authApi } from '@/modules/auth/api/auth.api';
import { AppAvatar, AppButton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The signed-in user's profile photo: click or drop an image on it, or use the buttons. Takes effect immediately. */
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

const auth = useAuthStore();
const feedback = useFeedbackStore();
const name = computed(() => `${auth.user?.firstName ?? ''} ${auth.user?.lastName ?? ''}`.trim() || 'User');
const photo = computed(() => auth.user?.avatarUrl ?? null);
const input = ref<HTMLInputElement | null>(null);
const busy = ref<'upload' | 'remove' | null>(null);
const error = ref<string | null>(null);
const dragging = ref(false);

function pick() {
  if (!busy.value) input.value?.click();
}

async function upload(file: File | undefined) {
  if (!file) return;
  error.value = !ACCEPTED.includes(file.type) ? 'Upload a PNG, JPG or WebP image' : file.size > MAX_BYTES ? 'The photo must be 5 MB or smaller' : null;
  if (error.value) return;
  busy.value = 'upload';
  try {
    await authApi.uploadAvatar(file);
    await auth.loadContext();
    feedback.success('Photo updated');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = null;
    if (input.value) input.value.value = '';
  }
}

async function remove() {
  if (!(await feedback.confirm({ title: 'Remove your photo?', message: 'Your initials will be shown instead.', confirmLabel: 'Remove photo', danger: true }))) return;
  busy.value = 'remove';
  error.value = null;
  try {
    await authApi.removeAvatar();
    await auth.loadContext();
    feedback.success('Photo removed');
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
  <div class="flex items-center gap-4">
    <button
      type="button"
      :disabled="!!busy"
      :aria-label="photo ? 'Change photo' : 'Upload a photo'"
      :class="['group relative shrink-0 rounded-full transition', dragging && 'ring-4 ring-brand-500/30']"
      @click="pick"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <AppAvatar :name="name" :src="photo" size="xl" />
      <span v-if="!busy" class="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-950/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <Camera :size="18" aria-hidden="true" />
      </span>
      <span v-else class="absolute inset-0 flex items-center justify-center rounded-full bg-surface/70">
        <Loader2 :size="18" class="animate-spin text-brand-600" aria-hidden="true" />
      </span>
    </button>
    <div class="min-w-0">
      <div class="flex flex-wrap gap-2">
        <AppButton size="sm" variant="secondary" :icon="Upload" :loading="busy === 'upload'" :disabled="!!busy" @click="pick">{{ photo ? 'Change photo' : 'Upload photo' }}</AppButton>
        <AppButton v-if="photo" size="sm" variant="ghost" :icon="Trash2" :loading="busy === 'remove'" :disabled="!!busy" @click="remove">Remove</AppButton>
      </div>
      <p class="mt-2 text-xs text-fg-muted">PNG, JPG or WebP, up to 5 MB. Cropped to a square around your face.</p>
      <p v-if="error" class="mt-1 text-xs font-medium text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </div>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-label="Photo file" @change="upload(($event.target as HTMLInputElement).files?.[0])" />
  </div>
</template>
