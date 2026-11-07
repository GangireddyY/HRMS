<script setup lang="ts">
import { ArrowLeft, Compass } from '@lucide/vue';
import { AppButton } from '@/shared/components';
</script>

<template>
  <div class="bg-dots relative flex min-h-full flex-col items-center justify-center bg-canvas px-4 text-center">
    <div class="relative mb-4">
      <div class="absolute inset-0 -m-6 rounded-full bg-brand-500/10 blur-2xl" aria-hidden="true" />
      <div class="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-brand-600 shadow-card dark:text-brand-400">
        <Compass :size="28" aria-hidden="true" />
      </div>
    </div>
    <p class="text-sm font-semibold text-brand-600 dark:text-brand-400">Error 404</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
    <p class="mt-3 max-w-md text-sm text-fg-muted">The page you're looking for doesn't exist or has moved.</p>
    <AppButton class="mt-4" :icon="ArrowLeft" to="/">Back to HRMS</AppButton>
  </div>
</template>
