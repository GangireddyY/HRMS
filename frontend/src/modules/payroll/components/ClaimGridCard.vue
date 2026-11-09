<script setup lang="ts">
import { computed } from 'vue';
import { Banknote, CalendarDays, Check, FileImage, FileText, FileX, Hourglass, MessageSquareText, Undo2, X } from '@lucide/vue';
import type { Claim } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_VISUALS } from '@/modules/payroll/utils/claim-visuals';
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, claimTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/**
 * An expense claim in the grid. `review`: the claimant on top, how long it has waited and Approve / Reject; `mine`: the
 * employee's own claim with its progress and Withdraw. `selectable` keeps the top-start corner free for the bulk checkbox.
 */
const props = withDefaults(defineProps<{ claim: Claim; mode: 'review' | 'mine'; selectable?: boolean; slaDays?: number; note?: string | null }>(), { selectable: false, slaDays: 7, note: null });
const emit = defineEmits<{ approve: []; reject: []; withdraw: []; receipt: [] }>();

const c = computed(() => props.claim);
const visual = computed(() => CLAIM_CATEGORY_VISUALS[c.value.category]);
const waited = computed(() => Math.floor((Date.now() - new Date(c.value.createdAt).getTime()) / 86_400_000));
const overdue = computed(() => c.value.status === 'PENDING' && waited.value > props.slaDays);
const struck = computed(() => c.value.status === 'CANCELLED' || c.value.status === 'REJECTED');
const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const fileKind = (contentType: string) => (contentType === 'application/pdf' ? 'PDF' : contentType.replace('image/', '').toUpperCase());
const progress = computed(() => {
  if (props.mode === 'mine') return props.note;
  if (c.value.payroll) return `${c.value.status === 'PAID' ? 'Paid in' : 'In'} the ${c.value.payroll.period} payroll`;
  return null;
});
const reviewed = computed(() =>
  c.value.reviewedBy && c.value.status !== 'PENDING' && !(props.mode === 'mine' && c.value.status === 'REJECTED' && !c.value.reviewNote)
    ? `${c.value.status === 'REJECTED' ? 'Rejected' : 'Approved'} by ${c.value.reviewedBy}${c.value.reviewedAt ? ` · ${formatDate(c.value.reviewedAt)}` : ''}`
    : null,
);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div v-if="mode === 'review'" :class="['-mx-4 -mt-4 flex items-center gap-2.5 border-b border-line/60 bg-surface-muted/40 py-2.5 pe-4', selectable ? 'ps-12' : 'ps-4']">
      <AppAvatar :name="c.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ c.employee?.name }}</p>
        <p class="truncate text-2xs text-fg-muted">
          <span class="font-mono">{{ c.employee?.employeeCode }}</span><template v-if="c.employee?.department"> · {{ c.employee.department }}</template>
        </p>
      </div>
      <span v-if="c.status === 'PENDING'" :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums', overdue ? 'bg-danger-soft text-danger-fg' : waited >= 3 ? 'bg-warning-soft text-warning-fg' : 'bg-surface text-fg-muted ring-1 ring-line ring-inset']" :title="overdue ? `Waiting over ${slaDays} days` : undefined">
        <Hourglass :size="10" aria-hidden="true" /><span class="sr-only">Waiting </span>{{ waited === 0 ? 'Today' : `${waited} day${waited === 1 ? '' : 's'}` }}
      </span>
    </div>

    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ c.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ CLAIM_CATEGORY_LABELS[c.category] }}</p>
      </div>
      <AppBadge class="shrink-0" :tone="claimTone[c.status]" size="sm" dot>{{ CLAIM_STATUS_LABELS[c.status] }}</AppBadge>
    </div>

    <div>
      <p class="text-2xs font-medium text-fg-subtle">Amount</p>
      <p :class="['text-xl font-semibold tracking-tight tabular-nums', struck && mode === 'mine' ? 'text-fg-subtle line-through decoration-fg-subtle/50' : 'text-fg']">{{ rupees(c.amount, true) }}</p>
      <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
        <span class="inline-flex items-center gap-1"><CalendarDays :size="11" class="text-fg-subtle" aria-hidden="true" />Spent {{ formatDate(c.expenseDate) }}</span>
        <span :title="formatDateTime(c.createdAt)">{{ mode === 'mine' ? `Submitted ${formatDate(c.createdAt)}` : `Claimed ${timeAgo(c.createdAt)}` }}</span>
      </p>
    </div>

    <p v-if="c.description" class="line-clamp-2 text-xs text-fg-subtle">{{ c.description }}</p>

    <button
      v-if="c.receipt"
      type="button"
      class="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-2xs font-medium text-fg-muted ring-1 ring-line transition ring-inset hover:bg-surface-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      :aria-label="`Download receipt for ${c.title}: ${c.receipt.fileName}`"
      :title="c.receipt.fileName"
      @click.stop="emit('receipt')"
    >
      <component :is="c.receipt.contentType === 'application/pdf' ? FileText : FileImage" :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-start">{{ c.receipt.fileName }}</span>
      <span class="shrink-0 text-fg-subtle">{{ fileKind(c.receipt.contentType) }} · {{ fileSize(c.receipt.size) }}</span>
    </button>
    <p v-else class="flex h-8 items-center gap-2 rounded-lg border border-dashed border-line px-2.5 text-2xs text-fg-subtle"><FileX :size="13" aria-hidden="true" />No receipt attached</p>

    <div v-if="overdue || progress || reviewed" class="space-y-0.5 text-2xs">
      <p v-if="overdue && mode === 'review'" class="inline-flex items-center gap-1 font-medium text-danger-fg"><Hourglass :size="11" aria-hidden="true" />Waiting over {{ slaDays }} days</p>
      <p v-else-if="progress" class="flex items-center gap-1 text-fg-muted" :title="progress">
        <component :is="c.status === 'PENDING' ? Hourglass : c.status === 'REJECTED' ? MessageSquareText : Banknote" :size="11" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">{{ progress }}</span>
      </p>
      <p v-if="reviewed" class="truncate text-fg-subtle">{{ reviewed }}</p>
    </div>

    <div v-if="mode === 'review' ? c.permissions.review : c.permissions.cancel" class="mt-auto flex items-center justify-end gap-2 border-t border-line/60 pt-3">
      <template v-if="mode === 'review'">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
      <AppButton v-else size="xs" variant="ghost" :icon="Undo2" @click.stop="emit('withdraw')">Withdraw</AppButton>
    </div>
  </div>
</template>
