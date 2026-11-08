<script setup lang="ts">
import { ArrowLeft, ShieldAlert } from '@lucide/vue';
import { AppButton } from '@/shared/components';
</script>

<template>
  <div class="bg-dots relative flex min-h-full flex-col items-center justify-center bg-canvas px-4 text-center">
    <div class="relative mb-4">
      <div class="absolute inset-0 -m-6 rounded-full bg-warning/10 blur-2xl" aria-hidden="true" />
      <div class="relative flex h-16 w-16 items-center justify-center card text-warning-fg shadow-card">
        <ShieldAlert :size="28" aria-hidden="true" />
      </div>
    </div>
    <p class="text-sm font-semibold text-warning-fg">Error 403</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight">Access denied</h1>
    <p class="mt-3 max-w-md text-sm text-fg-muted">Your roles don't include access to this page. If you need it, ask your organization administrator.</p>
    <AppButton class="mt-4" :icon="ArrowLeft" to="/">Go to my workspace</AppButton>
  </div>
</template>
