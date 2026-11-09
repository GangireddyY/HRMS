<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ArrowRight, CheckCircle2, HeartPulse, Info } from '@lucide/vue';
import { AppCard, AppSkeleton } from '@/shared/components';

export interface HealthCheck {
  key: string;
  title: string;
  /** What was found, e.g. "2 invitations not accepted". */
  detail: string;
  state: 'pass' | 'warn' | 'fail' | 'info';
  to?: string;
  action?: string;
}

/** Access and security checks with a pass score; failing checks come first and link to where to fix them. */
const props = defineProps<{ checks: HealthCheck[]; loading?: boolean }>();

const ORDER = { fail: 0, warn: 1, info: 2, pass: 3 } as const;
const sorted = computed(() => [...props.checks].sort((a, b) => ORDER[a.state] - ORDER[b.state]));
const passed = computed(() => props.checks.filter((c) => c.state === 'pass' || c.state === 'info').length);
const pct = computed(() => (props.checks.length ? Math.round((passed.value / props.checks.length) * 100) : 0));
const ICON = { pass: CheckCircle2, info: Info, warn: AlertTriangle, fail: AlertTriangle } as const;
const TONE = { pass: 'text-success-fg', info: 'text-info-fg', warn: 'text-warning-fg', fail: 'text-danger-fg' } as const;
const STATE_TEXT = { pass: 'Passed', info: 'Note', warn: 'Needs attention', fail: 'Failed' } as const;
</script>

<template>
  <AppCard title="Access health" description="Sign-in and account checks" :icon="HeartPulse" :padded="false" fill>
    <template v-if="!loading && checks.length" #actions>
      <span :class="['rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums', pct === 100 ? 'bg-success-soft text-success-fg' : pct >= 60 ? 'bg-warning-soft text-warning-fg' : 'bg-danger-soft text-danger-fg']">
        {{ passed }} of {{ checks.length }} passed
      </span>
    </template>
    <div v-if="loading" class="p-4"><AppSkeleton :lines="6" /></div>
    <template v-else>
      <div class="px-4 pt-3" role="progressbar" :aria-valuenow="passed" :aria-valuemin="0" :aria-valuemax="checks.length" aria-label="Checks passed">
        <div class="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          <span v-for="c in sorted" :key="c.key" :class="['h-full flex-1', c.state === 'pass' ? 'bg-success' : c.state === 'info' ? 'bg-info' : c.state === 'warn' ? 'bg-warning' : 'bg-danger']" />
        </div>
      </div>
      <ul class="divide-y divide-line/60 py-1">
        <li v-for="c in sorted" :key="c.key">
          <component :is="c.to && c.state !== 'pass' ? 'RouterLink' : 'div'" :to="c.to" :class="['group flex items-start gap-3 px-4 py-2.5', c.to && c.state !== 'pass' && 'transition hover:bg-surface-muted/50']">
            <component :is="ICON[c.state]" :size="16" :class="['mt-0.5 shrink-0', TONE[c.state]]" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-fg">{{ c.title }}<span class="sr-only"> ({{ STATE_TEXT[c.state] }})</span></span>
              <span class="block text-xs text-fg-muted">{{ c.detail }}</span>
            </span>
            <span v-if="c.to && c.state !== 'pass'" class="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-accent-fg">
              {{ c.action ?? 'Fix' }}<ArrowRight :size="14" class="transition group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </component>
        </li>
      </ul>
    </template>
  </AppCard>
</template>
