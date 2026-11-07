<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Ban, FileText, Send } from '@lucide/vue';
import { EXIT_LETTER_TYPES, type ExitLetterType } from '@contracts';
import { exitApi } from '@/modules/exit/api/exit.api';
import type { ExitDetail, ExitLetterSummary, LetterDraft } from '@/modules/exit/types';
import { LETTER_LABELS, localIso } from '@/modules/exit/utils/exit-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppErrorState, AppInput, AppModal, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** HR: issue, open and revoke the relieving letter and experience certificate of a completed exit. */
const props = defineProps<{ exit: ExitDetail }>();
const router = useRouter();
const feedback = useFeedbackStore();
const letters = useAsync(() => exitApi.letters(props.exit.id));
const active = (type: ExitLetterType) => letters.data.value?.find((l) => l.type === type && !l.revokedAt) ?? null;
const revoked = computed(() => letters.data.value?.filter((l) => l.revokedAt) ?? []);
const open = (l: ExitLetterSummary) => router.push(`/hr/exits/${props.exit.id}/letters/${l.id}`);

// ---- Issue ----
const { fieldErrors, formError, handle, reset } = useFormErrors();
const issuing = ref<ExitLetterType | null>(null);
const loadingDraft = ref(false);
const form = reactive<LetterDraft>({ type: 'RELIEVING', letterDate: '', subject: '', body: '', signatoryName: '', signatoryTitle: null });
const today = localIso(new Date());
async function startIssue(type: ExitLetterType) {
  reset();
  loadingDraft.value = true;
  issuing.value = type;
  try {
    Object.assign(form, await exitApi.letterDraft(props.exit.id, type));
  } catch (e) {
    issuing.value = null;
    feedback.error('Could not prepare the letter', e);
  } finally {
    loadingDraft.value = false;
  }
}
const busy = ref(false);
async function issue() {
  reset();
  busy.value = true;
  try {
    const letter = await exitApi.issueLetter(props.exit.id, { ...form, signatoryTitle: form.signatoryTitle || null });
    feedback.success(`${LETTER_LABELS[letter.type]} issued`, `Reference ${letter.reference}. ${props.exit.employee?.name ?? 'The employee'} has been told.`);
    issuing.value = null;
    await letters.run();
  } catch (e) {
    handle(e, 'Could not issue the letter');
  } finally {
    busy.value = false;
  }
}

// ---- Revoke ----
const revoking = ref<ExitLetterSummary | null>(null);
const revokeReason = ref('');
async function revoke() {
  if (!revoking.value) return;
  busy.value = true;
  try {
    await exitApi.revokeLetter(props.exit.id, revoking.value.id, revokeReason.value);
    feedback.success('Letter revoked', 'You can issue a corrected one.');
    revoking.value = null;
    revokeReason.value = '';
    await letters.run();
  } catch (e) {
    feedback.error('Could not revoke the letter', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="letters.loading.value && !letters.data.value" :lines="4" />
    <AppErrorState v-else-if="letters.error.value" :error="letters.error.value" @retry="letters.run" />
    <template v-else>
      <div class="grid gap-4 md:grid-cols-2">
        <AppCard v-for="type in EXIT_LETTER_TYPES" :key="type" :title="LETTER_LABELS[type]" :icon="FileText">
          <template v-if="active(type)">
            <p class="text-sm text-fg">
              <span class="font-medium">{{ active(type)!.reference }}</span> · dated {{ formatDate(active(type)!.letterDate) }}
            </p>
            <p class="mt-1 text-xs text-fg-muted">Issued by {{ active(type)!.issuedBy ?? '—' }}, {{ formatDateTime(active(type)!.issuedAt) }} · signed by {{ active(type)!.signatoryName }}</p>
          </template>
          <p v-else class="text-sm text-fg-muted">Not issued yet. You'll start from a suggested text you can edit.</p>
          <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
              <template v-if="active(type)">
                <AppButton size="sm" variant="ghost" :icon="Ban" :disabled="!exit.permissions.letters" @click="revoking = active(type)">Revoke</AppButton>
                <AppButton size="sm" variant="secondary" @click="open(active(type)!)">Open</AppButton>
              </template>
              <AppButton v-else size="sm" :icon="Send" :disabled="!exit.permissions.letters" :loading="loadingDraft && issuing === type" @click="startIssue(type)">Issue</AppButton>
            </div>
          </template>
        </AppCard>
      </div>
      <AppCard v-if="revoked.length" title="Revoked letters">
        <ul class="divide-y divide-line text-sm">
          <li v-for="l in revoked" :key="l.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p class="text-fg">{{ l.reference }} · {{ LETTER_LABELS[l.type] }} <AppBadge size="sm" tone="danger">Revoked</AppBadge></p>
              <p class="text-xs text-fg-muted">{{ l.revokedBy }}, {{ formatDate(l.revokedAt) }} — {{ l.revokedReason }}</p>
            </div>
            <AppButton size="sm" variant="ghost" @click="open(l)">Open</AppButton>
          </li>
        </ul>
      </AppCard>
    </template>

    <AppModal :open="!!issuing && !loadingDraft" :title="`Issue the ${issuing ? LETTER_LABELS[issuing].toLowerCase() : 'letter'}`" description="Check and edit the text. Once issued, the letter is numbered and can't be changed (revoke it to issue a new one)." size="lg" @close="issuing = null">
      <form id="issue-letter-form" class="space-y-4" novalidate @submit.prevent="issue">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppDatePicker v-model="form.letterDate" label="Letter date" required :min="exit.lastWorkingDay ?? undefined" :max="today" :error="fieldErrors.letterDate" />
          <AppInput v-model="form.subject" label="Subject" required :maxlength="200" :error="fieldErrors.subject" />
        </div>
        <AppTextarea v-model="form.body" label="Letter" required :rows="12" :max-rows="24" :maxlength="10000" help="Separate paragraphs with a blank line." :error="fieldErrors.body" />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.signatoryName" label="Signed by" required :maxlength="200" :error="fieldErrors.signatoryName" />
          <AppInput v-model="form.signatoryTitle as string" label="Signatory's title" :maxlength="200" :error="fieldErrors.signatoryTitle" />
        </div>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="issuing = null">Cancel</AppButton>
        <AppButton type="submit" form="issue-letter-form" :icon="Send" :loading="busy">Issue letter</AppButton>
      </template>
    </AppModal>

    <AppModal :open="!!revoking" :title="`Revoke ${revoking?.reference}?`" description="The employee no longer sees it. The letter stays on record as revoked." size="sm" @close="revoking = null">
      <AppTextarea v-model="revokeReason" label="Reason" required :rows="3" :maxlength="1000" />
      <template #footer>
        <AppButton variant="secondary" @click="revoking = null">Keep it</AppButton>
        <AppButton variant="danger" :loading="busy" :disabled="revokeReason.trim().length < 3" @click="revoke">Revoke</AppButton>
      </template>
    </AppModal>
  </div>
</template>
