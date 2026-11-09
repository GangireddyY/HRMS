<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Clock, KeyRound, Lock, LockKeyhole, Smartphone } from '@lucide/vue';
import type { SecurityPolicy } from '@/modules/organization/types';
import { AppBadge, AppButton, AppCard, AppSkeleton } from '@/shared/components';

/** Two-factor adoption as a ring, and the sign-in rules in force (passwords, lockout, sessions). */
const props = defineProps<{ adoption: number | null; activeUsers: number; policy: SecurityPolicy | null; loading?: boolean; settingsTo?: string }>();

const CIRC = 2 * Math.PI * 40;
const tone = computed(() => (props.adoption === null ? 'text-fg-subtle' : props.adoption >= 80 ? 'text-success' : props.adoption >= 50 ? 'text-warning' : 'text-danger'));
const enrolled = computed(() => (props.adoption === null ? 0 : Math.round((props.activeUsers * props.adoption) / 100)));
const rules = computed(() => {
  const p = props.policy;
  if (!p) return [];
  const classes = [p.passwordRequireUppercase && 'upper', p.passwordRequireLowercase && 'lower', p.passwordRequireNumber && 'number', p.passwordRequireSymbol && 'symbol'].filter(Boolean).join(', ');
  return [
    { key: 'password', icon: KeyRound, label: 'Passwords', value: `At least ${p.passwordMinLength} characters${classes ? ` · ${classes}` : ''}` },
    { key: 'expiry', icon: Clock, label: 'Password expiry', value: p.passwordMaxAgeDays ? `Every ${p.passwordMaxAgeDays} days` : 'Never expire' },
    { key: 'lockout', icon: Lock, label: 'Lockout', value: `After ${p.lockoutThreshold} failed attempts, for ${p.lockoutDurationMinutes} min` },
    { key: 'session', icon: Smartphone, label: 'Sessions', value: `Sign out after ${p.sessionIdleTimeoutMinutes} min idle · ${p.sessionMaxLifetimeHours} h max` },
  ];
});
</script>

<template>
  <AppCard title="Security posture" description="2FA and sign-in rules" :icon="LockKeyhole" fill>
    <template v-if="settingsTo" #actions><AppButton size="sm" variant="ghost" :to="settingsTo">Settings</AppButton></template>
    <AppSkeleton v-if="loading" :lines="6" />
    <template v-else>
      <div class="flex items-center gap-4">
        <div class="relative h-24 w-24 shrink-0">
          <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="40" fill="none" stroke-width="10" class="stroke-surface-muted" />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke-width="10"
              stroke-linecap="round"
              stroke="currentColor"
              :class="['transition-[stroke-dashoffset] duration-700', tone]"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="CIRC * (1 - (adoption ?? 0) / 100)"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-xl font-semibold text-fg tabular-nums">{{ adoption ?? '—' }}%</span>
            <span class="text-2xs text-fg-muted">use 2FA</span>
          </div>
        </div>
        <div class="min-w-0 space-y-1.5">
          <p class="text-sm text-fg"><span class="font-semibold tabular-nums">{{ enrolled }}</span> of <span class="tabular-nums">{{ activeUsers }}</span> active users have two-factor sign-in on.</p>
          <AppBadge v-if="policy" :tone="policy.mfaRequired ? 'success' : 'warning'" size="sm" dot>{{ policy.mfaRequired ? 'Required for everyone' : 'Not required' }}</AppBadge>
          <AppButton v-if="policy && !policy.mfaRequired && settingsTo" class="block" size="xs" variant="link" :icon-right="ArrowRight" :to="settingsTo">Require two-factor sign-in</AppButton>
        </div>
      </div>
      <dl v-if="rules.length" class="mt-4 space-y-2.5 border-t border-line/70 pt-4">
        <div v-for="r in rules" :key="r.key" class="flex items-start gap-3">
          <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="r.icon" :size="14" /></span>
          <div class="min-w-0">
            <dt class="text-xs text-fg-muted">{{ r.label }}</dt>
            <dd class="text-sm text-fg">{{ r.value }}</dd>
          </div>
        </div>
      </dl>
    </template>
  </AppCard>
</template>
