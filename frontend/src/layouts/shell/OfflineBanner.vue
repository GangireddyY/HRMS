<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { CloudOff } from '@lucide/vue';
import { t } from '@/core/i18n/i18n';

/** Shown while the browser has no connection: pages already open keep working, changes need the connection. */
const offline = ref(typeof navigator !== 'undefined' && !navigator.onLine);
const update = () => (offline.value = !navigator.onLine);
onMounted(() => {
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', update);
  window.removeEventListener('offline', update);
});
</script>

<template>
  <div v-if="offline" class="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-medium text-warning-fg" role="status">
    <CloudOff :size="14" aria-hidden="true" />
    {{ t('shell.offline') }}
  </div>
</template>
