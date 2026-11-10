<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { BadgeCheck, FileSignature, RotateCcw, Save } from '@lucide/vue';
import { DEFAULT_OFFER_LETTER, OFFER_LETTER_PLACEHOLDERS } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { offersApi } from '@/modules/recruitment/api/offers.api';
import { AppAlert, AppButton, AppCard, AppErrorState, AppInput, AppPageHeader, AppSkeleton, AppSwitch, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useUnsavedGuard } from '@/shared/composables/use-unsaved-guard';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The offer letter every released offer uses (frozen into each offer at release), and whether offers need approval. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const template = useAsync(() => offersApi.template());
const settings = useAsync(() => offersApi.settings());
const canApprove = computed(() => auth.can('recruitment.offer.approve'));

const form = reactive({ subject: '', body: '' });
watch(
  () => template.data.value,
  (t) => {
    if (t) Object.assign(form, { subject: t.subject, body: t.body });
  },
  { immediate: true },
);
const dirty = computed(() => !!template.data.value && (form.subject !== template.data.value.subject || form.body !== template.data.value.body));
useUnsavedGuard(dirty, { message: 'Your offer letter changes are not saved yet.' });
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    template.data.value = await offersApi.saveTemplate({ ...form });
    feedback.success('Offer letter saved', 'Offers released from now on use it; released offers keep the letter they were sent.');
  } catch (e) {
    handle(e, 'Could not save the template');
  } finally {
    saving.value = false;
  }
}
const restoreDefault = () => Object.assign(form, { subject: DEFAULT_OFFER_LETTER.subject, body: DEFAULT_OFFER_LETTER.body });

function insert(key: string) {
  const el = document.querySelector<HTMLTextAreaElement>('#offer-letter-body textarea, textarea#offer-letter-body');
  const text = token(key);
  if (!el) {
    form.body += text;
    return;
  }
  const [s, e] = [el.selectionStart, el.selectionEnd];
  form.body = form.body.slice(0, s) + text + form.body.slice(e);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + text.length, s + text.length);
  });
}

// Live preview with sample values, rendered the same way as the server (escaped; paragraphs, lists and bold only).
const SAMPLE: Record<keyof typeof OFFER_LETTER_PLACEHOLDERS, string> = {
  candidate_name: 'Meera Iyer',
  candidate_first_name: 'Meera',
  designation: 'Backend Engineer',
  department: 'Engineering',
  location: 'Bengaluru',
  employment_type: 'Full time',
  annual_ctc: '₹18,00,000',
  joining_date: '1 December 2026',
  offer_expiry: '20 November 2026',
  organization_name: auth.organization?.name ?? 'Your organization',
  today: '10 November 2026',
};
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fill = (t: string) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (w, k: string) => (k in SAMPLE ? SAMPLE[k as keyof typeof SAMPLE] : w));
const preview = computed(() => {
  const html = esc(fill(form.body))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split('\n').filter((l) => l.trim());
      return lines.length && lines.every((l) => l.trimStart().startsWith('- ')) ? `<ul>${lines.map((l) => `<li>${l.trimStart().slice(2)}</li>`).join('')}</ul>` : `<p>${lines.join('<br>')}</p>`;
    })
    .join('');
  return `<!doctype html><html><body style="font-family:Georgia,serif;color:#111827;max-width:640px;margin:24px auto;padding:0 20px;line-height:1.6;font-size:14px"><h2 style="font-size:16px">${esc(fill(form.subject))}</h2>${html}</body></html>`;
});
const unknown = computed(() => [...new Set([...`${form.subject}\n${form.body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))].filter((k) => !(k in OFFER_LETTER_PLACEHOLDERS)));
/** Built here: double braces can't appear inside a template interpolation. */
const token = (key: string) => ['{', '{', key, '}', '}'].join('');
const unknownText = computed(() => unknown.value.map(token).join(', '));
const chips = Object.entries(OFFER_LETTER_PLACEHOLDERS).map(([key, label]) => ({ key, label, token: token(key) }));

const savingSetting = ref(false);
async function toggleApproval(on: boolean) {
  savingSetting.value = true;
  try {
    settings.data.value = await offersApi.saveSettings(on);
    feedback.success(on ? 'Every offer now needs approval' : 'Only offers above the budget need approval');
  } catch (e) {
    feedback.error('Could not save the setting', e);
  } finally {
    savingSetting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Offers & letters" description="The offer letter candidates read and sign, and when offers need approval before they're released." />

    <AppCard title="Offer approval" :icon="BadgeCheck">
      <AppSkeleton v-if="settings.loading.value && !settings.data.value" :lines="2" />
      <template v-else-if="settings.data.value">
        <AppSwitch
          :model-value="settings.data.value.offerApprovalRequired"
          :disabled="!canApprove || savingSetting"
          label="Every offer needs approval"
          description="Someone with “Approve offers” (never the person who drafted it) approves before release. Offers above the requisition's budget always need it."
          @update:model-value="toggleApproval"
        />
        <p v-if="!canApprove" class="mt-2 text-xs text-fg-muted">Only approvers can change this.</p>
      </template>
    </AppCard>

    <div class="grid items-start gap-4 xl:grid-cols-2">
      <AppCard title="Offer letter" :icon="FileSignature" description="Plain text: a blank line starts a paragraph, “- ” starts a list item, **text** is bold.">
        <AppSkeleton v-if="template.loading.value && !template.data.value" :lines="8" />
        <AppErrorState v-else-if="template.error.value" :error="template.error.value" @retry="template.run" />
        <form v-else class="space-y-4" novalidate @submit.prevent="save">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppAlert v-if="unknown.length" tone="warning">Unknown placeholders: {{ unknownText }}</AppAlert>
          <AppInput v-model="form.subject" label="Title" :maxlength="200" :error="fieldErrors.subject" />
          <AppTextarea id="offer-letter-body" v-model="form.body" label="Letter" :rows="16" :maxlength="20000" :error="fieldErrors.body" class="font-mono" />
          <div>
            <p class="mb-1.5 text-xs font-medium text-fg-muted">Insert a placeholder</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in chips" :key="c.key" type="button" class="rounded-md bg-surface-muted px-2 py-1 font-mono text-2xs text-fg hover:bg-accent-soft" :title="c.label" @click="insert(c.key)">{{ c.token }}</button>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <p v-if="template.data.value?.isDefault && !dirty" class="me-auto text-xs text-fg-muted">Using the standard letter</p>
            <AppButton variant="ghost" :icon="RotateCcw" @click="restoreDefault">Standard letter</AppButton>
            <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!dirty || !!unknown.length">Save letter</AppButton>
          </div>
        </form>
      </AppCard>
      <AppCard title="Preview" description="With sample details; each offer fills in its own." :padded="false">
        <iframe :srcdoc="preview" sandbox="" title="Offer letter preview" class="h-[620px] w-full rounded-b-lg bg-white" />
      </AppCard>
    </div>
  </div>
</template>
