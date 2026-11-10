<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, FileSignature, FileText, PartyPopper, Printer, ShieldCheck, Trash2, Upload, XCircle } from '@lucide/vue';
import { BLOOD_GROUPS, GENDERS, PREJOINING_DOCUMENT_CATEGORIES, type PrejoiningDocumentCategory } from '@contracts';
import { apiAssetUrl } from '@/core/http/http-client';
import { offerPortalApi, type PortalView } from '@/modules/recruitment/api/offers.api';
import { AppAlert, AppBadge, AppButton, AppCheckbox, AppDatePicker, AppErrorState, AppInput, AppModal, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** The candidate's private offer page: read and sign the letter, then share details and documents before joining. */
const route = useRoute();
const feedback = useFeedbackStore();
const token = computed(() => String(route.params.token));
const view = ref<PortalView | null>(null);
const loading = ref(true);
const error = ref<unknown>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    view.value = await offerPortalApi.view(token.value);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
void load();

const v = computed(() => view.value);
const logo = computed(() => apiAssetUrl(v.value?.organization.logoUrl));

// ---- Signing ---------------------------------------------------------------------------------
const signedName = ref('');
const agree = ref(false);
const busy = ref<string | null>(null);
const { fieldErrors, formError, handle, reset } = useFormErrors();
async function accept() {
  reset();
  busy.value = 'accept';
  try {
    view.value = await offerPortalApi.accept(token.value, signedName.value);
    feedback.success('Offer accepted', 'Thank you! You can now share your details for joining below.');
  } catch (e) {
    handle(e, 'Could not accept the offer');
  } finally {
    busy.value = null;
  }
}
const declineOpen = ref(false);
const declineReason = ref('');
async function decline() {
  busy.value = 'decline';
  try {
    view.value = await offerPortalApi.decline(token.value, declineReason.value || null);
    declineOpen.value = false;
  } catch (e) {
    feedback.error('Could not record your answer', e);
  } finally {
    busy.value = null;
  }
}

function printLetter() {
  if (!v.value?.letterHtml) return;
  const url = URL.createObjectURL(new Blob([v.value.letterHtml], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- Pre-joining -----------------------------------------------------------------------------
const details = reactive({ dateOfBirth: undefined as string | undefined, gender: null as string | null, phone: '', address: '', permanentAddress: '', emergencyContactName: '', emergencyContactPhone: '', bloodGroup: null as string | null, pan: '' });
watch(
  () => v.value?.prejoining.details,
  (d) => {
    if (!d) return;
    Object.assign(details, {
      dateOfBirth: d.dateOfBirth ?? undefined,
      gender: d.gender ?? null,
      phone: d.phone ?? '',
      address: d.address ?? '',
      permanentAddress: d.permanentAddress ?? '',
      emergencyContactName: d.emergencyContactName ?? '',
      emergencyContactPhone: d.emergencyContactPhone ?? '',
      bloodGroup: d.bloodGroup ?? null,
      pan: '',
    });
  },
  { immediate: true },
);
const genderOptions = GENDERS.map((g) => ({ value: g, label: g === 'NON_BINARY' ? 'Non-binary' : g === 'UNDISCLOSED' ? 'Prefer not to say' : g.charAt(0) + g.slice(1).toLowerCase() }));
const bloodOptions = BLOOD_GROUPS.map((b) => ({ value: b, label: b }));
const categoryOptions = PREJOINING_DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() }));
async function saveDetails() {
  reset();
  busy.value = 'details';
  try {
    view.value = await offerPortalApi.saveDetails(token.value, {
      dateOfBirth: details.dateOfBirth ?? null,
      gender: details.gender,
      phone: details.phone || null,
      address: details.address || null,
      permanentAddress: details.permanentAddress || null,
      emergencyContactName: details.emergencyContactName || null,
      emergencyContactPhone: details.emergencyContactPhone || null,
      bloodGroup: details.bloodGroup,
      ...(details.pan ? { pan: details.pan } : {}),
    });
    feedback.success('Details saved', 'HR will see them before your first day.');
  } catch (e) {
    handle(e, 'Could not save your details');
  } finally {
    busy.value = null;
  }
}

const doc = reactive({ category: 'IDENTITY' as PrejoiningDocumentCategory, title: '' });
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
async function upload() {
  if (!file.value) return;
  busy.value = 'upload';
  try {
    view.value = await offerPortalApi.upload(token.value, file.value, doc.category, doc.title);
    doc.title = '';
    file.value = null;
    if (fileInput.value) fileInput.value.value = '';
  } catch (e) {
    feedback.error('Could not upload the document', e);
  } finally {
    busy.value = null;
  }
}
async function removeDoc(id: string) {
  try {
    view.value = await offerPortalApi.removeDocument(token.value, id);
  } catch (e) {
    feedback.error('Could not remove the document', e);
  }
}
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <img v-if="logo" :src="logo" alt="" class="h-9 w-9 rounded-lg object-contain" />
        <p class="text-sm font-semibold text-fg">{{ v?.organization.name ?? 'Your offer' }}</p>
      </div>
    </header>

    <main id="main" class="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <AppSkeleton v-if="loading && !v" :lines="10" />
      <template v-else-if="error">
        <AppErrorState :error="error" title="This offer link isn't valid" @retry="load" />
        <p class="text-center text-sm text-fg-muted">It may have expired or been replaced. Ask the recruiter for a new link.</p>
      </template>
      <template v-else-if="v">
        <section class="card hero-soft relative overflow-hidden p-6">
          <p class="text-sm text-fg-muted">Hi {{ v.candidate.firstName }},</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-fg">
            <template v-if="v.offer.status === 'ACCEPTED'">Welcome aboard!</template>
            <template v-else-if="v.offer.status === 'DECLINED'">You declined this offer</template>
            <template v-else>Your offer{{ v.offer.designation ? ` as ${v.offer.designation}` : '' }}</template>
          </h1>
          <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            <span>Joining {{ formatDate(v.offer.joiningDate) }}</span>
            <span v-if="v.offer.location">{{ v.offer.location }}</span>
            <span v-if="v.offer.expiresOn && v.offer.status === 'RELEASED'" :class="v.offer.expired ? 'text-danger-fg' : ''">{{ v.offer.expired ? 'Expired' : 'Respond by' }} {{ formatDate(v.offer.expiresOn) }}</span>
          </p>
        </section>

        <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section class="card overflow-hidden" aria-labelledby="letter-title">
            <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 id="letter-title" class="flex items-center gap-2 text-sm font-semibold text-fg"><FileText :size="15" aria-hidden="true" />Offer letter</h2>
              <AppButton size="sm" variant="ghost" :icon="Printer" @click="printLetter">Print or save</AppButton>
            </div>
            <iframe v-if="v.letterHtml" :srcdoc="v.letterHtml" sandbox="" title="Offer letter" class="h-[640px] w-full bg-white" />
          </section>

          <aside class="space-y-4">
            <div v-if="v.signature" class="card p-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-success-fg"><ShieldCheck :size="16" aria-hidden="true" />Signed electronically</p>
              <p class="mt-1 text-sm text-fg">“{{ v.signature.name }}”</p>
              <p class="text-xs text-fg-muted">{{ formatDateTime(v.signature.at) }}</p>
              <p class="mt-1 truncate font-mono text-2xs text-fg-subtle" :title="v.signature.letterHash">Document SHA-256 {{ v.signature.letterHash }}</p>
            </div>

            <div v-if="v.canRespond" class="card space-y-3 p-4">
              <h2 class="flex items-center gap-2 text-sm font-semibold text-fg"><FileSignature :size="15" aria-hidden="true" />Accept and sign</h2>
              <AppAlert v-if="formError">{{ formError }}</AppAlert>
              <AppInput v-model="signedName" label="Type your full name" :placeholder="v.candidate.name" autocomplete="name" :error="fieldErrors.signedName" />
              <AppCheckbox v-model="agree" label="I have read the offer letter and agree that typing my name is my electronic signature." />
              <AppButton class="w-full" :icon="CheckCircle2" :loading="busy === 'accept'" :disabled="!agree || signedName.trim().length < 2" @click="accept">Accept and sign</AppButton>
              <AppButton class="w-full" variant="ghost" :icon="XCircle" @click="declineOpen = true">Decline the offer</AppButton>
              <p class="text-2xs text-fg-subtle">Your name, the time, your IP address and a fingerprint of this letter are recorded with the signature.</p>
            </div>
            <AppAlert v-else-if="v.offer.status === 'RELEASED' && v.offer.expired" tone="warning">This offer has expired. Contact the recruiter if you'd still like to join.</AppAlert>
            <AppAlert v-if="v.prejoining.hired" tone="success" title="You're all set">Your details are with HR. See you on {{ formatDate(v.offer.joiningDate) }}!</AppAlert>
          </aside>
        </div>

        <section v-if="v.prejoining.open" class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" aria-label="Before you join">
          <form class="card space-y-4 p-4" novalidate @submit.prevent="saveDetails">
            <div>
              <h2 class="flex items-center gap-2 text-sm font-semibold text-fg"><PartyPopper :size="15" aria-hidden="true" />Before you join</h2>
              <p class="text-xs text-fg-muted">Share these so your employee record is ready on day one. Only HR sees them.</p>
            </div>
            <AppBadge v-if="v.prejoining.submittedAt" size="sm" tone="success" dot>Saved {{ formatDateTime(v.prejoining.submittedAt) }}</AppBadge>
            <div class="grid gap-4 sm:grid-cols-2">
              <AppDatePicker v-model="details.dateOfBirth" label="Date of birth" :error="fieldErrors.dateOfBirth" />
              <AppSelect v-model="details.gender" label="Gender" :options="genderOptions" placeholder="Choose" :searchable="false" />
              <AppInput v-model="details.phone" label="Mobile number" inputmode="tel" :error="fieldErrors.phone" />
              <AppSelect v-model="details.bloodGroup" label="Blood group" :options="bloodOptions" placeholder="Choose" :searchable="false" />
            </div>
            <AppTextarea v-model="details.address" label="Current address" :rows="2" :maxlength="500" />
            <AppTextarea v-model="details.permanentAddress" label="Permanent address (if different)" :rows="2" :maxlength="500" />
            <div class="grid gap-4 sm:grid-cols-2">
              <AppInput v-model="details.emergencyContactName" label="Emergency contact" :maxlength="120" />
              <AppInput v-model="details.emergencyContactPhone" label="Their phone" inputmode="tel" :error="fieldErrors.emergencyContactPhone" />
            </div>
            <AppInput v-model="details.pan" label="PAN" :placeholder="v.prejoining.details?.hasPan ? `${v.prejoining.details.pan} (saved; type to change)` : 'ABCDE1234F'" :maxlength="10" :error="fieldErrors.pan" />
            <div class="flex justify-end"><AppButton type="submit" :loading="busy === 'details'">Save details</AppButton></div>
          </form>

          <div class="card space-y-3 p-4">
            <h2 class="text-sm font-semibold text-fg">Documents</h2>
            <p class="text-xs text-fg-muted">ID and address proof, education and experience certificates. PDF or image, 5 MB each.</p>
            <ul v-if="v.prejoining.documents.length" class="divide-y divide-line/70 rounded-lg border border-line">
              <li v-for="d in v.prejoining.documents" :key="d.id" class="flex items-center gap-2 px-3 py-2 text-sm">
                <FileText :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{{ d.title }} <span class="text-xs text-fg-subtle">· {{ d.category.toLowerCase() }}</span></span>
                <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Remove ${d.title}`" @click="removeDoc(d.id)" />
              </li>
            </ul>
            <template v-if="v.prejoining.documents.length < v.prejoining.maxDocuments">
              <AppSelect v-model="doc.category" label="Type" :options="categoryOptions" :clearable="false" :searchable="false" />
              <AppInput v-model="doc.title" label="Name" placeholder="e.g. Aadhaar card" :maxlength="200" />
              <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-control px-3 py-2 text-sm text-fg-muted hover:border-brand-500 hover:text-fg">
                <Upload :size="15" aria-hidden="true" /><span class="truncate">{{ file ? file.name : 'Choose a file' }}</span>
                <input ref="fileInput" type="file" class="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
              </label>
              <AppButton class="w-full" :loading="busy === 'upload'" :disabled="!file || doc.title.trim().length < 2" @click="upload">Upload</AppButton>
            </template>
          </div>
        </section>
      </template>
    </main>

    <AppModal :open="declineOpen" title="Decline the offer?" description="We'll let the recruiter know. You can share a reason if you like." size="sm" dialog :guide="false" @close="declineOpen = false">
      <AppTextarea v-model="declineReason" label="Reason (optional)" :rows="3" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="declineOpen = false">Cancel</AppButton>
        <AppButton variant="danger" :loading="busy === 'decline'" @click="decline">Decline offer</AppButton>
      </template>
    </AppModal>
  </div>
</template>
