<script setup lang="ts">
import { computed } from 'vue';
import { Clock, Mail, ShieldCheck, ShieldOff } from '@lucide/vue';
import type { Member } from '@/modules/users/types';
import { AppAvatar, AppBadge } from '@/shared/components';
import { timeAgo } from '@/shared/utils/format';
import { membershipTone, statusLabel } from '@/shared/utils/status';

/** A profile card for the Users grid: cover, photo, name, roles as the headline, and account status. */
const props = defineProps<{ member: Member }>();

const name = computed(() => `${props.member.firstName} ${props.member.lastName}`);
const headline = computed(() => props.member.roles.map((r) => r.name).join(' · ') || 'No role assigned');

/** Deterministic cover per person, so the same user always gets the same banner. */
const covers = [
  'from-indigo-500 via-sky-500 to-cyan-400',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-amber-400 via-orange-500 to-rose-500',
  'from-violet-500 via-purple-500 to-fuchsia-500',
  'from-sky-500 via-blue-600 to-indigo-600',
  'from-rose-400 via-pink-500 to-fuchsia-500',
  'from-teal-400 via-emerald-500 to-lime-500',
  'from-slate-500 via-slate-600 to-slate-800',
];
const cover = computed(() => covers[[...props.member.email].reduce((a, c) => a + c.charCodeAt(0), 0) % covers.length]);
</script>

<template>
  <RouterLink
    :to="`/admin/users/${member.id}`"
    class="group card card-interactive flex h-full flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none"
    :aria-label="`${name}, ${headline}, ${statusLabel(member.status)}`"
  >
    <div :class="['relative h-16 bg-gradient-to-br', cover]" aria-hidden="true">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_20%_120%,rgba(255,255,255,0.35),transparent_55%)]" />
      <span class="absolute end-2 top-2 rounded-full bg-surface shadow-xs">
        <AppBadge :tone="membershipTone[member.status]" size="sm" dot>{{ statusLabel(member.status) }}</AppBadge>
      </span>
    </div>

    <div class="flex flex-1 flex-col items-center px-4 pb-4 text-center">
      <div class="relative z-10 -mt-10 rounded-full bg-surface p-1 shadow-xs">
        <AppAvatar :name="name" :src="member.avatarUrl" size="2xl" />
      </div>
      <p class="mt-2 w-full truncate text-base font-semibold text-fg group-hover:text-accent-fg group-hover:underline">{{ name }}</p>
      <p class="mt-0.5 line-clamp-2 min-h-10 text-sm text-fg-muted">{{ headline }}</p>
      <p class="mt-2 flex w-full items-center justify-center gap-1 text-xs text-fg-subtle">
        <Mail :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ member.email }}</span>
      </p>

      <div class="mt-auto w-full pt-4">
        <div class="flex items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted">
          <span class="inline-flex min-w-0 items-center gap-1">
            <Clock :size="12" class="shrink-0" aria-hidden="true" />
            <span class="truncate">{{ member.lastLoginAt ? `Active ${timeAgo(member.lastLoginAt)}` : 'Never signed in' }}</span>
          </span>
          <span :class="['inline-flex shrink-0 items-center gap-1', member.mfaEnabled ? 'text-success-fg' : '']">
            <component :is="member.mfaEnabled ? ShieldCheck : ShieldOff" :size="12" aria-hidden="true" />
            2FA {{ member.mfaEnabled ? 'on' : 'off' }}
          </span>
        </div>
        <span
          class="mt-3 inline-flex h-8 w-full items-center justify-center rounded-full text-sm font-semibold text-accent-fg ring-1 ring-current transition group-hover:bg-accent-soft"
          aria-hidden="true"
        >
          View profile
        </span>
      </div>
    </div>
  </RouterLink>
</template>
