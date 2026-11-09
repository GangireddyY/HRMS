<script setup lang="ts">
import { computed } from 'vue';
import { BadgeCheck, CalendarDays, CalendarPlus, Check, Quote, X } from '@lucide/vue';
import type { ProbationReview } from '@/modules/onboarding/types';
import { RECOMMENDATION_LABELS, REVIEW_STATUS_LABELS, reviewStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A probation recommendation in the decisions grid: confirm or extend, the assessment behind it, and the decision. */
const props = defineProps<{ review: ProbationReview }>();
const emit = defineEmits<{ approve: []; reject: [] }>();

const r = computed(() => props.review);
const confirm = computed(() => r.value.recommendation === 'CONFIRM');
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="r.employee?.name ?? '?'" size="md" />
      <div class="min-w-0 flex-1">
        <RouterLink v-if="r.employee" :to="`/hr/employees/${r.employee.id}`" class="block truncate text-sm font-semibold text-fg hover:underline" @click.stop>{{ r.employee.name }}</RouterLink>
        <p v-else class="truncate text-sm font-semibold text-fg-muted">Former employee</p>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ r.employee?.designation?.name ?? r.employee?.employeeCode ?? '—' }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="reviewStatusTone[r.status]" size="sm" dot>{{ REVIEW_STATUS_LABELS[r.status] }}</AppBadge>
        <span v-if="r.reviewedBy" class="max-w-32 truncate text-2xs text-fg-subtle" :title="r.reviewedAt ? formatDate(r.reviewedAt) : undefined">
          by {{ r.reviewedBy }}<template v-if="r.reviewedAt"> · {{ timeAgo(r.reviewedAt) }}</template>
        </span>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-2">
      <div :class="['rounded-lg px-3 py-2', confirm ? 'bg-success-soft' : 'bg-warning-soft']">
        <dt class="flex items-center gap-1 text-2xs text-fg-muted"><component :is="confirm ? BadgeCheck : CalendarPlus" :size="11" aria-hidden="true" />Recommendation</dt>
        <dd :class="['mt-0.5 truncate text-xs font-semibold', confirm ? 'text-success-fg' : 'text-warning-fg']">{{ RECOMMENDATION_LABELS[r.recommendation] }}</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CalendarDays :size="11" aria-hidden="true" />{{ r.extendTo ? 'Extend until' : 'Probation ends' }}</dt>
        <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ formatDate(r.extendTo ?? r.probationEndDate) }}</dd>
        <dd v-if="r.extendTo" class="truncate text-2xs text-fg-subtle">was {{ formatDate(r.probationEndDate) }}</dd>
      </div>
    </dl>

    <figure class="flex gap-2 rounded-lg border border-line/70 px-3 py-2.5" :title="r.comments">
      <Quote :size="12" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      <blockquote class="line-clamp-3 text-xs leading-relaxed text-fg">{{ r.comments }}</blockquote>
    </figure>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="r.submittedBy ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ r.submittedBy ?? 'Someone' }}</p>
        <p class="truncate text-2xs text-fg-subtle" :title="`Recommended ${formatDate(r.submittedAt)}`">{{ timeAgo(r.submittedAt) }}</p>
      </div>
      <template v-if="r.status === 'PENDING'">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
    </div>
  </div>
</template>
