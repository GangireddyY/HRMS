<script setup lang="ts">
import { computed } from 'vue';
import { Building2, Clock, Globe } from '@lucide/vue';
import type { LoginEventRow } from '@/modules/audit/types';
import { OUTCOME_VISUAL, TONE_TILE, describeIp, deviceIcon, reasonText } from '@/modules/audit/utils/audit-visuals';
import { AppAvatar } from '@/shared/components';
import { describeUserAgent, formatDateTime, fullName, timeAgo } from '@/shared/utils/format';

/**
 * One sign-in attempt in the grid: who, the result, from which device and address, and when. `own` is the signed-in
 * user's history (My account): the result leads instead of the person, with the organization signed into.
 */
const props = defineProps<{ event: LoginEventRow; own?: boolean }>();

const outcome = computed(() => OUTCOME_VISUAL[props.event.outcome] ?? OUTCOME_VISUAL.FAILURE!);
const ip = computed(() => describeIp(props.event.ipAddress));
const name = computed(() => (props.event.user ? fullName(props.event.user) : (props.event.email ?? 'Unknown user')));
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div v-if="own" class="flex items-center gap-3">
      <span :class="['grid h-10 w-10 shrink-0 place-items-center rounded-xl', TONE_TILE[outcome.tone]]" aria-hidden="true"><component :is="outcome.icon" :size="18" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ outcome.label }}</h3>
        <p class="flex items-center gap-1 truncate text-xs text-fg-muted">
          <Building2 :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />{{ event.organization?.name ?? 'No organization chosen' }}
        </p>
      </div>
      <time :datetime="event.createdAt" :title="formatDateTime(event.createdAt)" class="shrink-0 text-xs whitespace-nowrap text-fg-muted">{{ timeAgo(event.createdAt) }}</time>
    </div>
    <div v-else class="flex items-center gap-3">
      <AppAvatar :name="name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ name }}</h3>
        <p v-if="event.email && event.user" class="truncate text-xs text-fg-muted">{{ event.email }}</p>
        <p v-else-if="!event.user" class="text-xs text-fg-subtle">No matching account</p>
      </div>
      <span :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium', TONE_TILE[outcome.tone]]">
        <component :is="outcome.icon" :size="13" aria-hidden="true" />
        {{ outcome.label }}
      </span>
    </div>

    <p v-if="event.failureReason" class="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger-fg">
      {{ reasonText(event.failureReason) }}
    </p>

    <dl class="mt-auto grid gap-2 rounded-xl bg-surface-muted/60 p-3 text-xs">
      <div class="flex items-center gap-2">
        <dt class="sr-only">Device</dt>
        <component :is="deviceIcon(event.userAgent)" :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <dd class="min-w-0 truncate text-fg" :title="event.userAgent ?? undefined">{{ describeUserAgent(event.userAgent) }}</dd>
      </div>
      <div class="flex items-center gap-2">
        <dt class="sr-only">IP address</dt>
        <Globe :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <dd :class="['min-w-0 truncate text-fg', /^[\d.:a-f]+$/i.test(ip) && 'font-mono']" :title="event.ipAddress ?? undefined">{{ ip }}</dd>
      </div>
      <div class="flex items-center gap-2">
        <dt class="sr-only">When</dt>
        <Clock :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <dd class="min-w-0 truncate text-fg">
          <time :datetime="event.createdAt">{{ formatDateTime(event.createdAt) }}</time>
          <span class="text-fg-muted"> · {{ timeAgo(event.createdAt) }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>
