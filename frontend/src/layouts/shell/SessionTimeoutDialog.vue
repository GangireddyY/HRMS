<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Clock } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { useIdleMonitor } from '@/core/auth/idle-monitor';
import { AppButton, AppModal } from '@/shared/components';

/** Warns before the organization's idle sign-out and lets the user stay signed in (WCAG 2.2.1 Timing Adjustable). */
const auth = useAuthStore();
const router = useRouter();
const timeout = computed(() => auth.context?.idleTimeoutMinutes ?? null);
const staying = ref(false);

async function signOutIdle() {
  const minutes = timeout.value;
  await auth.logout();
  await router.push({ name: 'login', query: { reason: 'idle', minutes: minutes ? String(minutes) : undefined, redirect: router.currentRoute.value.fullPath } });
}

const { warning, remainingMs, extend } = useIdleMonitor(timeout, () => void signOutIdle());
const countdown = computed(() => {
  const s = Math.ceil(remainingMs.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

async function stay() {
  staying.value = true;
  extend();
  try {
    await auth.refresh();
  } finally {
    staying.value = false;
  }
}
</script>

<template>
  <AppModal :open="warning" dialog size="sm" title="Are you still there?" :description="`For your security you'll be signed out after ${timeout} minutes without activity.`" @close="stay">
    <div class="flex items-center gap-3">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-fg"><Clock :size="18" aria-hidden="true" /></span>
      <p class="text-sm text-fg-muted">
        Signing out in <span class="font-semibold text-fg tabular-nums" aria-live="off">{{ countdown }}</span>. Anything you haven't saved will be lost.
      </p>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="signOutIdle">Sign out</AppButton>
      <AppButton autofocus :loading="staying" @click="stay">Stay signed in</AppButton>
    </template>
  </AppModal>
</template>
