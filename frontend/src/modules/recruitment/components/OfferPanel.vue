<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { BadgeCheck, CheckCircle2, ClipboardCheck, Copy, Download, FileText, Link2, Send, ShieldCheck, UserCheck, X } from '@lucide/vue';
import type { ApplicationStage, OfferApprovalStatus } from '@contracts';
import { offersApi, type PrejoiningView } from '@/modules/recruitment/api/offers.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { OFFER_STATUS_LABELS, money, offerTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppApprovalProgress, AppBadge, AppButton, AppErrorState, AppModal, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** An offer from draft to signed: approval, the letter, the candidate's link, signature and pre-joining details. */
const props = defineProps<{ offerId: string; stage: ApplicationStage; canHire: boolean }>();
const emit = defineEmits<{ edit: []; hire: []; changed: [] }>();
const feedback = useFeedbackStore();
const offer = useAsync(() => offersApi.get(props.offerId));
watch(() => props.offerId, () => void offer.run());
const o = computed(() => offer.data.value);

const APPROVAL: Record<OfferApprovalStatus, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  NOT_REQUIRED: { label: 'Approval needed', tone: 'warning' },
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Approval rejected', tone: 'danger' },
};
const needsApproval = computed(() => !!o.value?.approval.required && o.value.approval.status !== 'APPROVED');
const canDecide = computed(() => !!o.value?.approval.canDecide);

const busy = ref<string | null>(null);
async function run(key: string, fn: () => Promise<unknown>, success: string) {
  busy.value = key;
  try {
    await fn();
    feedback.success(success);
    await offer.run();
    emit('changed');
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}

const link = ref<string | null>(null);
async function release() {
  busy.value = 'release';
  try {
    const r = await offersApi.release(props.offerId);
    link.value = r.portalUrl;
    feedback.success('Offer released', r.emailed ? 'The candidate has been emailed a private link to read and sign it.' : 'The email could not be sent; share the link below with the candidate.');
    await offer.run();
    emit('changed');
  } catch (e) {
    feedback.error('Could not release the offer', e);
  } finally {
    busy.value = null;
  }
}
async function resend() {
  busy.value = 'link';
  try {
    const r = await offersApi.resendLink(props.offerId);
    link.value = r.portalUrl;
    feedback.success('New link issued', r.emailed ? 'Emailed to the candidate; the previous link no longer works.' : 'Share the link below; the previous one no longer works.');
  } catch (e) {
    feedback.error('Could not issue a new link', e);
  } finally {
    busy.value = null;
  }
}
async function copy() {
  if (!link.value) return;
  await navigator.clipboard.writeText(link.value).catch(() => undefined);
  feedback.success('Link copied');
}

const deciding = ref<'approve' | 'reject' | null>(null);
const note = ref('');
const declineOpen = ref(false);
const declineReason = ref('');

const pre = ref<PrejoiningView | null>(null);
async function loadPrejoining() {
  try {
    pre.value = await offersApi.prejoining(props.offerId);
  } catch (e) {
    feedback.error('Could not load the pre-joining details', e);
  }
}
const DETAIL_LABELS: [keyof NonNullable<PrejoiningView['details']>, string][] = [
  ['dateOfBirth', 'Date of birth'],
  ['gender', 'Gender'],
  ['phone', 'Phone'],
  ['address', 'Current address'],
  ['permanentAddress', 'Permanent address'],
  ['emergencyContactName', 'Emergency contact'],
  ['emergencyContactPhone', 'Emergency phone'],
  ['bloodGroup', 'Blood group'],
  ['pan', 'PAN'],
];
</script>

<template>
  <AppSkeleton v-if="offer.loading.value && !o" :lines="5" />
  <AppErrorState v-else-if="offer.error.value" :error="offer.error.value" @retry="offer.run" />
  <div v-else-if="o" class="space-y-4">
    <div class="flex flex-wrap items-center gap-1.5">
      <AppBadge :tone="offerTone[o.status]" dot>{{ OFFER_STATUS_LABELS[o.status] }}</AppBadge>
      <AppBadge v-if="o.status === 'DRAFT' && (o.approval.required || o.approval.status !== 'NOT_REQUIRED')" size="sm" :tone="APPROVAL[o.approval.status].tone">{{ APPROVAL[o.approval.status].label }}</AppBadge>
      <AppBadge v-if="o.signature" size="sm" tone="success"><ShieldCheck :size="11" aria-hidden="true" />E-signed</AppBadge>
    </div>
    <div>
      <p class="text-2xs font-medium text-fg-muted">Annual CTC</p>
      <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ money(o.annualCtc) }}</p>
      <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt class="text-2xs font-medium text-fg-muted">Joining</dt><dd class="text-fg">{{ formatDate(o.joiningDate) }}</dd></div>
        <div v-if="o.expiresOn"><dt class="text-2xs font-medium text-fg-muted">Valid until</dt><dd class="text-fg">{{ formatDate(o.expiresOn) }}</dd></div>
      </dl>
    </div>

    <AppAlert v-if="o.status === 'DRAFT' && needsApproval" tone="warning" :title="o.approval.status === 'PENDING' ? 'Waiting for approval' : 'Needs approval before release'">
      {{ o.approval.required }}.
      <template v-if="o.approval.status === 'PENDING' && o.approval.requestedBy"> Sent by {{ o.approval.requestedBy }} {{ formatDateTime(o.approval.requestedAt!) }}.</template>
      <template v-if="o.approval.status === 'REJECTED' && o.approval.note"> “{{ o.approval.note }}” — {{ o.approval.decidedBy }}</template>
    </AppAlert>
    <p v-else-if="o.status === 'DRAFT' && o.approval.status === 'APPROVED'" class="flex items-center gap-1.5 text-xs text-success-fg"><BadgeCheck :size="13" aria-hidden="true" />Approved by {{ o.approval.decidedBy }}<template v-if="o.approval.note"> · “{{ o.approval.note }}”</template></p>
    <AppApprovalProgress v-if="o.approval.chain && o.approval.status !== 'NOT_REQUIRED'" :progress="o.approval.chain" class="rounded-xl bg-surface-muted/50 p-3" />

    <div v-if="o.signature" class="rounded-xl bg-success-soft/50 p-3 text-xs text-fg ring-1 ring-success/20 ring-inset">
      <p class="flex items-center gap-1.5 font-semibold text-success-fg"><ShieldCheck :size="13" aria-hidden="true" />Signed by “{{ o.signature.name }}”</p>
      <p class="mt-1 text-fg-muted">{{ formatDateTime(o.signature.at) }}<template v-if="o.signature.ip"> · IP {{ o.signature.ip }}</template></p>
      <p class="mt-0.5 truncate font-mono text-2xs text-fg-subtle" :title="o.signature.letterHash">SHA-256 {{ o.signature.letterHash }}</p>
    </div>

    <div v-if="link" class="rounded-xl border border-line bg-surface-muted/50 p-3">
      <p class="flex items-center gap-1.5 text-xs font-medium text-fg"><Link2 :size="13" aria-hidden="true" />Candidate's private link</p>
      <div class="mt-1.5 flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-2xs">{{ link }}</code>
        <AppButton size="xs" variant="secondary" :icon="Copy" @click="copy">Copy</AppButton>
      </div>
      <p class="mt-1 text-2xs text-fg-subtle">Shown once. Issue a new link if it's lost; the old one then stops working.</p>
    </div>

    <div v-if="o.status === 'ACCEPTED'" class="rounded-xl border border-line p-3">
      <div class="flex items-center justify-between gap-2">
        <p class="flex items-center gap-1.5 text-sm font-medium text-fg"><ClipboardCheck :size="14" aria-hidden="true" />Pre-joining</p>
        <AppButton v-if="o.prejoining.submittedAt || o.prejoining.documents" size="xs" variant="link" @click="loadPrejoining">{{ pre ? 'Refresh' : 'View' }}</AppButton>
      </div>
      <p class="mt-1 text-xs text-fg-muted">
        <template v-if="o.prejoining.submittedAt">Details shared {{ formatDateTime(o.prejoining.submittedAt) }}</template><template v-else>No details shared yet</template>
        · {{ o.prejoining.documents }} document{{ o.prejoining.documents === 1 ? '' : 's' }}. {{ stage === 'HIRED' ? 'Moved to the employee record.' : 'Copied to the employee on hire.' }}
      </p>
      <template v-if="pre">
        <dl v-if="pre.details" class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <template v-for="[k, label] in DETAIL_LABELS" :key="k">
            <div v-if="pre.details[k]"><dt class="text-fg-subtle">{{ label }}</dt><dd class="text-fg">{{ pre.details[k] }}</dd></div>
          </template>
        </dl>
        <ul v-if="pre.documents.length" class="mt-3 divide-y divide-line/70 rounded-lg border border-line">
          <li v-for="d in pre.documents" :key="d.id" class="flex items-center gap-2 px-2.5 py-1.5 text-xs">
            <FileText :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-fg">{{ d.title }} <span class="text-fg-subtle">· {{ d.category.toLowerCase() }}</span></span>
            <AppButton size="xs" variant="ghost" :icon="Download" :aria-label="`Download ${d.title}`" @click="offersApi.downloadPrejoiningDocument(o!.id, d.id, d.fileName)" />
          </li>
        </ul>
      </template>
    </div>

    <div class="flex flex-wrap gap-2 border-t border-line/70 pt-4">
      <template v-if="o.status === 'DRAFT'">
        <AppButton size="sm" variant="secondary" @click="emit('edit')">Edit</AppButton>
        <AppButton size="sm" variant="ghost" :icon="FileText" @click="offersApi.openLetter(o.id)">Preview letter</AppButton>
        <AppButton v-if="needsApproval && o.approval.status !== 'PENDING'" size="sm" :icon="Send" :loading="busy === 'submit'" @click="run('submit', () => offersApi.submitForApproval(o!.id), 'Sent for approval')">Send for approval</AppButton>
        <template v-if="canDecide">
          <AppButton size="sm" :icon="CheckCircle2" @click="deciding = 'approve'; note = ''">Approve</AppButton>
          <AppButton size="sm" variant="secondary" :icon="X" aria-label="Reject approval" @click="deciding = 'reject'; note = ''" />
        </template>
        <AppButton v-if="!needsApproval" size="sm" :icon="Send" :loading="busy === 'release'" @click="release">Release</AppButton>
      </template>
      <template v-else-if="o.status === 'RELEASED'">
        <AppButton size="sm" variant="ghost" :icon="FileText" @click="offersApi.openLetter(o.id)">Letter</AppButton>
        <AppButton size="sm" variant="secondary" :icon="Link2" :loading="busy === 'link'" @click="resend">New candidate link</AppButton>
        <AppButton size="sm" variant="ghost" :loading="busy === 'accept'" @click="run('accept', () => recruitmentApi.respondOffer(o!.id, 'ACCEPTED'), 'Offer marked as accepted')">Mark accepted</AppButton>
        <AppButton size="sm" variant="ghost" @click="declineOpen = true; declineReason = ''">Mark declined</AppButton>
      </template>
      <template v-else-if="o.status === 'ACCEPTED'">
        <AppButton size="sm" variant="ghost" :icon="FileText" @click="offersApi.openLetter(o.id)">Signed letter</AppButton>
        <AppButton v-if="stage !== 'HIRED'" size="sm" variant="secondary" :icon="Link2" :loading="busy === 'link'" @click="resend">New candidate link</AppButton>
        <AppButton v-if="stage !== 'HIRED'" size="sm" :icon="UserCheck" :disabled="!canHire" @click="emit('hire')">Hire</AppButton>
      </template>
      <AppButton v-if="stage !== 'HIRED' && ['DRAFT', 'RELEASED', 'ACCEPTED'].includes(o.status)" size="sm" variant="ghost" :loading="busy === 'withdraw'" @click="run('withdraw', () => recruitmentApi.withdrawOffer(o!.id), 'Offer withdrawn')">Withdraw</AppButton>
    </div>
    <p v-if="o.status === 'ACCEPTED' && !canHire && stage !== 'HIRED'" class="text-xs text-fg-muted">Hiring creates the employee record; someone with permission to create employees completes it.</p>

    <AppModal :open="!!deciding" :title="deciding === 'approve' ? 'Approve offer' : 'Reject offer approval'" :description="`${money(o.annualCtc)} · joining ${formatDate(o.joiningDate)}`" size="sm" dialog :guide="false" @close="deciding = null">
      <p v-if="o.approval.required" class="mb-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted">{{ o.approval.required }}</p>
      <AppTextarea v-model="note" :label="deciding === 'approve' ? 'Note' : 'Reason'" :required="deciding === 'reject'" :rows="2" :maxlength="500" :placeholder="deciding === 'approve' ? 'Optional' : 'e.g. Keep within the band'" />
      <template #footer>
        <AppButton variant="secondary" @click="deciding = null">Cancel</AppButton>
        <AppButton
          :variant="deciding === 'approve' ? 'primary' : 'danger'"
          :loading="busy === 'decide'"
          :disabled="deciding === 'reject' && note.trim().length < 3"
          @click="run('decide', () => (deciding === 'approve' ? offersApi.approve(o!.id, note || null) : offersApi.rejectApproval(o!.id, note)), deciding === 'approve' ? 'Offer approved' : 'Offer sent back').then(() => (deciding = null))"
        >
          {{ deciding === 'approve' ? 'Approve' : 'Reject' }}
        </AppButton>
      </template>
    </AppModal>
    <AppModal :open="declineOpen" title="Record a decline" size="sm" dialog :guide="false" @close="declineOpen = false">
      <AppTextarea v-model="declineReason" label="Reason (optional)" :rows="2" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="declineOpen = false">Cancel</AppButton>
        <AppButton variant="danger" @click="declineOpen = false; run('decline', () => recruitmentApi.respondOffer(o!.id, 'DECLINED', declineReason || null), 'Offer marked as declined')">Record decline</AppButton>
      </template>
    </AppModal>
  </div>
</template>
