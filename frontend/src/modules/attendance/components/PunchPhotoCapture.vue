<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Camera, RefreshCw } from '@lucide/vue';
import { AppAlert, AppButton, AppModal } from '@/shared/components';

/** Takes a photo with the front camera for punch-in (scaled down, JPEG); emits the data URL. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; captured: [photo: string] }>();

const WIDTH = 480;
const video = ref<HTMLVideoElement | null>(null);
const photo = ref<string | null>(null);
const error = ref<string | null>(null);
const starting = ref(false);
let stream: MediaStream | null = null;

function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
async function start() {
  stop();
  photo.value = null;
  error.value = null;
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = "This browser can't use the camera. Try another browser or the phone app.";
    return;
  }
  starting.value = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
    await nextTick();
    if (video.value) {
      video.value.srcObject = stream;
      await video.value.play().catch(() => undefined);
    }
  } catch (e) {
    error.value = e instanceof DOMException && e.name === 'NotAllowedError' ? 'Allow the camera for this site, then try again.' : 'The camera could not be started.';
  } finally {
    starting.value = false;
  }
}
function capture() {
  const v = video.value;
  if (!v || !v.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = Math.round((v.videoHeight / v.videoWidth) * WIDTH);
  canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
  photo.value = canvas.toDataURL('image/jpeg', 0.8);
  stop();
}
watch(
  () => props.open,
  (open) => (open ? void start() : stop()),
);
onBeforeUnmount(stop);
</script>

<template>
  <AppModal :open="open" dialog :guide="false" title="Punch-in photo" description="Your office asks for a photo with every punch-in." @close="emit('close')">
    <div class="space-y-3">
      <AppAlert v-if="error">{{ error }}</AppAlert>
      <div class="relative overflow-hidden rounded-xl bg-fg/90" style="aspect-ratio: 4 / 3">
        <img v-if="photo" :src="photo" alt="Your photo" class="h-full w-full object-cover" />
        <video v-else ref="video" class="h-full w-full -scale-x-100 object-cover" autoplay playsinline muted aria-label="Camera preview" />
        <p v-if="starting" class="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting the camera…</p>
      </div>
      <p class="text-xs text-fg-muted">The photo is kept with today's attendance and seen only by you, your manager and HR.</p>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <template v-if="photo">
        <AppButton variant="secondary" :icon="RefreshCw" @click="start">Retake</AppButton>
        <AppButton @click="emit('captured', photo)">Use photo and punch in</AppButton>
      </template>
      <AppButton v-else :icon="Camera" :disabled="!!error || starting" @click="capture">Take photo</AppButton>
    </template>
  </AppModal>
</template>
