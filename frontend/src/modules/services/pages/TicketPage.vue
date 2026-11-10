<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CircleCheck, Clock, Lock, Send, Star } from '@lucide/vue';
import { HELPDESK_CATEGORY_LABELS, HELPDESK_PRIORITIES, HELPDESK_STATUSES, type HelpdeskPriority, type HelpdeskStatus } from '@contracts';
import { helpdeskApi } from '@/modules/services/api/services.api';
import type { TicketDetail } from '@/modules/services/types';
import { dueIn, HELPDESK_PRIORITY_LABELS, HELPDESK_STATUS_AGENT_LABELS, HELPDESK_STATUS_LABELS, helpdeskPriorityTone, helpdeskStatusTone } from '@/modules/services/utils/services-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppFacts, AppPageHeader, AppSelect, AppSkeleton, AppSwitch, AppTextarea, type Fact } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/**
 * One helpdesk ticket as a conversation. Employees reply, close or rate it; agents reply (or leave internal notes),
 * and set the status, assignee and priority.
 */
const route = useRoute();
const feedback = useFeedbackStore();
const hrSide = computed(() => route.path.startsWith('/hr/'));
const id = computed(() => String(route.params.id));
const ticket = useAsync(() => helpdeskApi.get(id.value));
const t = computed(() => ticket.data.value);
const agent = computed(() => !!t.value?.permissions.manage);
const labels = computed(() => (agent.value ? HELPDESK_STATUS_AGENT_LABELS : HELPDESK_STATUS_LABELS));
const agents = useAsync(() => (hrSide.value ? helpdeskApi.agents() : Promise.resolve([])));

const facts = computed<Fact[]>(() => {
  const x = t.value;
  if (!x) return [];
  return [
    { label: 'Reference', value: x.reference, mono: true },
    { label: 'Topic', value: HELPDESK_CATEGORY_LABELS[x.category] },
    { label: 'Opened', value: formatDateTime(x.createdAt) },
    { label: 'First reply', value: x.firstResponseAt ? formatDateTime(x.firstResponseAt) : 'Not yet' },
    ...(x.resolvedAt ? [{ label: 'Resolved', value: formatDateTime(x.resolvedAt) }] : []),
  ];
});
const active = computed(() => !!t.value && ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.value.status));

// ---- Reply ---------------------------------------------------------------------------------------
const reply = reactive({ body: '', internal: false, status: null as HelpdeskStatus | null });
const replyStatusOptions = computed(() => HELPDESK_STATUSES.filter((s) => s !== 'CLOSED').map((s) => ({ value: s, label: `Then: ${HELPDESK_STATUS_AGENT_LABELS[s].toLowerCase()}` })));
const sending = ref(false);
async function send() {
  sending.value = true;
  try {
    ticket.data.value = await helpdeskApi.reply(id.value, { body: reply.body, internal: agent.value ? reply.internal : undefined, status: agent.value && !reply.internal && reply.status ? reply.status : undefined });
    Object.assign(reply, { body: '', internal: false, status: null });
  } catch (e) {
    feedback.error('Could not send', e);
  } finally {
    sending.value = false;
  }
}

// ---- Agent controls ------------------------------------------------------------------------------
const statusOptions = HELPDESK_STATUSES.map((s) => ({ value: s, label: HELPDESK_STATUS_AGENT_LABELS[s] }));
const priorityOptions = HELPDESK_PRIORITIES.map((p) => ({ value: p, label: HELPDESK_PRIORITY_LABELS[p] }));
const agentOptions = computed(() => (agents.data.value ?? []).map((a) => ({ value: a.id, label: a.name })));
async function update(body: { status?: HelpdeskStatus; assigneeId?: string | null; priority?: HelpdeskPriority }) {
  try {
    ticket.data.value = await helpdeskApi.update(id.value, body);
  } catch (e) {
    feedback.error('Could not update the ticket', e);
  }
}

// ---- Employee: rate / close ----------------------------------------------------------------------
const rating = reactive({ stars: 0, hover: 0, comment: '' });
const rating$ = ref(false);
async function rate() {
  rating$.value = true;
  try {
    ticket.data.value = await helpdeskApi.rate(id.value, { rating: rating.stars, comment: rating.comment || null });
    feedback.success('Thanks for the feedback');
  } catch (e) {
    feedback.error('Could not save the rating', e);
  } finally {
    rating$.value = false;
  }
}
async function close() {
  if (!(await feedback.confirm({ title: 'Close this ticket?', message: "Do this if you've sorted it out. You can raise a new ticket later.", confirmLabel: 'Close ticket' }))) return;
  try {
    ticket.data.value = await helpdeskApi.close(id.value);
  } catch (e) {
    feedback.error('Could not close it', e);
  }
}
const bubble = (m: TicketDetail['messages'][number]) =>
  m.internal ? 'bg-warning-soft/70 ring-1 ring-warning/30 ring-inset' : m.fromAgent === agent.value ? 'bg-accent-soft text-fg' : 'bg-surface-muted text-fg';
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="ticket.loading.value && !t" :lines="6" />
    <AppErrorState v-else-if="ticket.error.value" :error="ticket.error.value" @retry="ticket.run" />
    <template v-else-if="t">
      <AppPageHeader :title="t.subject" :description="`${t.reference} · ${HELPDESK_CATEGORY_LABELS[t.category]}${agent && t.employee ? ` · ${t.employee.name}` : ''}`" :back="hrSide ? '/hr/helpdesk' : '/me/helpdesk'" back-label="Helpdesk" />

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section class="card min-w-0 overflow-hidden" aria-label="Conversation">
          <ol class="space-y-4 p-4 sm:p-5">
            <li v-for="m in t.messages" :key="m.id" :class="['flex gap-3', m.fromAgent === agent ? 'flex-row-reverse text-end' : '']">
              <AppAvatar :name="m.author" size="sm" />
              <div :class="['min-w-0 max-w-[80%] rounded-2xl px-4 py-2.5 text-start', bubble(m)]">
                <p class="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
                  <span class="font-semibold text-fg">{{ m.author }}</span>
                  <span v-if="m.fromAgent && !agent">· HR</span>
                  <span v-if="m.internal" class="inline-flex items-center gap-1 font-medium text-warning-fg"><Lock :size="11" aria-hidden="true" />Internal note</span>
                  <span>· <time :datetime="m.createdAt" :title="formatDateTime(m.createdAt)">{{ timeAgo(m.createdAt) }}</time></span>
                </p>
                <p class="mt-1 text-sm break-words whitespace-pre-line">{{ m.body }}</p>
              </div>
            </li>
          </ol>

          <form v-if="t.permissions.reply" class="space-y-3 border-t border-line/70 bg-surface-muted/30 p-4" @submit.prevent="send">
            <AppTextarea
              v-model="reply.body"
              :label="reply.internal ? 'Internal note (only agents see it)' : 'Reply'"
              :rows="3"
              :maxlength="5000"
              :placeholder="agent ? 'Write to the employee…' : 'Add a reply for HR…'"
            />
            <div class="flex flex-wrap items-center gap-3">
              <AppSwitch v-if="agent" v-model="reply.internal" label="Internal note" />
              <div v-if="agent && !reply.internal" class="w-56"><AppSelect v-model="reply.status" :options="replyStatusOptions" placeholder="Keep status" aria-label="Status after replying" size="sm" /></div>
              <span class="flex-1" />
              <AppButton type="submit" :icon="Send" :loading="sending" :disabled="!reply.body.trim()">{{ reply.internal ? 'Add note' : t.status === 'RESOLVED' && !agent ? 'Reopen with reply' : 'Send' }}</AppButton>
            </div>
          </form>
          <p v-else class="border-t border-line/70 px-4 py-3 text-sm text-fg-muted">This ticket is closed. Raise a new one if you need more help.</p>
        </section>

        <aside class="space-y-4">
          <AppCard>
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <AppBadge :tone="helpdeskStatusTone[t.status]" dot>{{ labels[t.status] }}</AppBadge>
              <AppBadge :tone="helpdeskPriorityTone[t.priority]">{{ HELPDESK_PRIORITY_LABELS[t.priority] }} priority</AppBadge>
            </div>
            <p v-if="active" :class="['mb-3 flex items-center gap-1.5 text-xs font-medium', t.overdue ? 'text-danger-fg' : 'text-fg-muted']">
              <Clock :size="13" aria-hidden="true" />{{ agent ? `Resolution target: ${dueIn(t.dueAt)}` : `HR aims to resolve it by ${formatDateTime(t.dueAt)}` }}
            </p>
            <AppFacts :items="facts" />
            <p class="mt-3 text-xs text-fg-muted">{{ t.assignee ? `Handled by ${t.assignee.name}` : 'Not picked up yet' }}</p>
          </AppCard>

          <AppCard v-if="agent" title="Manage">
            <div class="space-y-3">
              <AppSelect :model-value="t.status" label="Status" :options="statusOptions" :clearable="false" @update:model-value="(s) => update({ status: s as HelpdeskStatus })" />
              <AppSelect :model-value="t.assignee?.id ?? null" label="Assigned to" :options="agentOptions" placeholder="Unassigned" @update:model-value="(v) => update({ assigneeId: (v as string | null) ?? null })" />
              <AppSelect :model-value="t.priority" label="Priority" :options="priorityOptions" :clearable="false" @update:model-value="(p) => update({ priority: p as HelpdeskPriority })" />
            </div>
          </AppCard>

          <AppCard v-if="t.permissions.rate" title="How did we do?">
            <div class="flex gap-1" role="radiogroup" aria-label="Rating">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="rating.stars === n"
                :aria-label="`${n} star${n === 1 ? '' : 's'}`"
                class="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                @click="rating.stars = n"
                @mouseenter="rating.hover = n"
                @mouseleave="rating.hover = 0"
              >
                <Star :size="26" :class="(rating.hover || rating.stars) >= n ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle'" aria-hidden="true" />
              </button>
            </div>
            <AppTextarea v-model="rating.comment" class="mt-3" label="Anything to add?" :rows="2" :maxlength="500" />
            <AppButton class="mt-3 w-full" :loading="rating$" :disabled="!rating.stars" @click="rate">Rate and close</AppButton>
          </AppCard>
          <AppCard v-else-if="t.rating" title="Rating">
            <p class="flex items-center gap-1" :aria-label="`${t.rating} of 5`">
              <Star v-for="n in 5" :key="n" :size="18" :class="t.rating >= n ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle'" aria-hidden="true" />
            </p>
            <p v-if="t.ratingComment" class="mt-2 text-sm text-fg-muted">“{{ t.ratingComment }}”</p>
          </AppCard>

          <AppButton v-if="t.permissions.close" variant="secondary" class="w-full" :icon="CircleCheck" @click="close">My question is sorted — close it</AppButton>
        </aside>
      </div>
    </template>
  </div>
</template>
