<script setup lang="ts">
import { CloudOff, RefreshCw } from '@lucide/vue';
import { computed } from 'vue';
import { ApiError, errorMessage } from '@/core/http/http-client';
import AppButton from '@/shared/components/forms/AppButton.vue';

const props = defineProps<{ error: unknown; title?: string }>();
defineEmits<{ retry: [] }>();

const message = computed(() => errorMessage(props.error));
const requestId = computed(() => (props.error instanceof ApiError ? props.error.requestId : undefined));
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4 py-8 text-center" role="alert">
    <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-600/15 ring-inset dark:bg-red-500/10 dark:text-red-400">
      <CloudOff :size="20" aria-hidden="true" />
    </div>
    <p class="text-sm font-semibold text-fg">{{ title ?? 'Could not load data' }}</p>
    <p class="mt-1 max-w-md text-sm text-fg-muted">{{ message }}</p>
    <p v-if="requestId" class="mt-2 rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-fg-subtle">Reference: {{ requestId }}</p>
    <AppButton class="mt-5" variant="secondary" size="sm" :icon="RefreshCw" @click="$emit('retry')">Try again</AppButton>
  </div>
</template>
