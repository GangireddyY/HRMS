<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  Link2,
  MapPin,
  MessagesSquare,
  Send,
  UploadCloud,
  Users,
  X,
} from '@lucide/vue';
import { RESUME_MAX_BYTES } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { apiAssetUrl } from '@/core/http/http-client';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { careersApi } from '@/modules/recruitment/api/recruitment.api';
import CareersShell from '@/modules/recruitment/components/CareersShell.vue';
import JobDescription from '@/modules/recruitment/components/JobDescription.vue';
import { careersPlace, jobFlags } from '@/modules/recruitment/utils/careers';
import { experience } from '@/modules/recruitment/utils/recruitment-format';
import { dueText } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAlert, AppButton, AppCheckbox, AppErrorState, AppInput, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Public job page with the application form (resume required, consent required). */
const route = useRoute();
const slug = computed(() => String(route.params.slug));
const jobId = computed(() => String(route.params.jobId));
const data = useAsync(() => careersApi.job(slug.value, jobId.value));
const org = computed(() => data.data.value?.organization ?? null);
const job = computed(() => data.data.value?.job ?? null);

const glance = computed(() => {
  const j = job.value;
  if (!j) return [];
  return [
    { icon: Building2, label: 'Team', value: j.department?.name },
    { icon: MapPin, label: 'Location', value: j.location?.name },
    { icon: Clock, label: 'Employment', value: EMPLOYMENT_TYPE_LABELS[j.employmentType] },
    { icon: GraduationCap, label: 'Experience', value: experience(j.experienceMin, j.experienceMax) },
    { icon: CalendarDays, label: 'Posted', value: j.postedAt ? `${formatDate(j.postedAt)} · ${timeAgo(j.postedAt)}` : null },
    { icon: CalendarClock, label: 'Applications close', value: j.closesOn ? `${formatDate(j.closesOn)} · ${dueText(j.closesOn, false).toLowerCase()}` : 'Open until filled' },
  ].filter((f) => f.value);
});
const orgFacts = computed(() => {
  const o = org.value;
  if (!o) return [];
  return [o.industry, o.companySize && `${o.companySize} people`, careersPlace(o, appLocale())].filter(Boolean) as string[];
});
const logo = computed(() => apiAssetUrl(org.value?.logoUrl ?? null));

// ---- Share -----------------------------------------------------------------------------------------------------
const copied = ref(false);
async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard blocked: the address bar still has the link.
  }
}

// ---- Application -----------------------------------------------------------------------------------------------
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ firstName: '', lastName: '', email: '', phone: '', linkedinUrl: '', coverNote: '', consent: false });
const resume = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const sending = ref(false);
const done = ref<string | null>(null);
const applySection = ref<HTMLElement | null>(null);

const ACCEPT = /\.(pdf|docx)$/i;
function take(f: File | undefined | null) {
  if (!f) return;
  if (!ACCEPT.test(f.name)) {
    fieldErrors.value = { ...fieldErrors.value, file: 'Please upload a PDF or Word (.docx) file' };
    return;
  }
  if (f.size > RESUME_MAX_BYTES) {
    fieldErrors.value = { ...fieldErrors.value, file: 'The resume must be 5 MB or smaller' };
    return;
  }
  fieldErrors.value = { ...fieldErrors.value, file: '' };
  resume.value = f;
}
function pick(e: Event) {
  take((e.target as HTMLInputElement).files?.[0]);
  (e.target as HTMLInputElement).value = '';
}
function drop(e: DragEvent) {
  dragging.value = false;
  take(e.dataTransfer?.files?.[0]);
}
const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const missing = computed(() =>
  [
    !form.firstName.trim() && 'first name',
    !form.lastName.trim() && 'last name',
    !form.email.includes('@') && 'email',
    !resume.value && 'resume',
    !form.consent && 'consent',
  ].filter(Boolean) as string[],
);
const canSend = computed(() => missing.value.length === 0);

async function apply() {
  reset();
  sending.value = true;
  try {
    const r = await careersApi.apply(slug.value, jobId.value, resume.value!, { ...form, consent: String(form.consent), phone: form.phone || null, linkedinUrl: form.linkedinUrl || null, coverNote: form.coverNote || null });
    done.value = r.message;
    await nextTick();
    applySection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    handle(e, 'Your application could not be sent');
  } finally {
    sending.value = false;
  }
}
const toApply = () => applySection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Phones get a sticky "Apply" bar until the form itself is on screen. */
const formInView = ref(false);
let observer: IntersectionObserver | null = null;
watch(applySection, (el) => {
  observer?.disconnect();
  if (!el || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(([entry]) => (formInView.value = !!entry?.isIntersecting), { rootMargin: '0px 0px -30% 0px' });
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

const NEXT_STEPS = [
  { icon: FileText, title: 'We review your application', text: 'The hiring team reads every application, usually within a week.' },
  { icon: MessagesSquare, title: 'We get in touch', text: 'If your profile is a match, we email you to set up a first conversation.' },
  { icon: Users, title: 'You meet the team', text: 'Interviews with the people you would work with, then a decision.' },
];
</script>

<template>
  <CareersShell :organization="org" :slug="slug">
    <div v-if="data.loading.value && !data.data.value" class="mx-auto max-w-6xl space-y-4 px-4 py-12 sm:px-6" aria-busy="true" aria-label="Loading the position">
      <div class="skeleton h-4 w-32 rounded-full" />
      <div class="skeleton h-10 w-1/2 rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="skeleton h-80 rounded-2xl" />
        <div class="skeleton h-64 rounded-2xl" />
      </div>
    </div>
    <div v-else-if="data.error.value" class="mx-auto max-w-3xl px-4 py-16">
      <AppErrorState :error="data.error.value" title="This position isn't open" @retry="data.run" />
      <div class="mt-4 text-center"><AppButton variant="secondary" :icon="ArrowLeft" :to="`/careers/${slug}`">See all open positions</AppButton></div>
    </div>
    <template v-else-if="job && org">
      <!-- Hero -->
      <section class="relative overflow-hidden border-b border-line/70">
        <div
          class="absolute inset-0"
          aria-hidden="true"
          style="
            background-image:
              radial-gradient(60% 140% at 100% 0%, color-mix(in oklab, var(--brand-500) 20%, transparent), transparent 70%),
              linear-gradient(180deg, color-mix(in oklab, var(--brand-500) 5%, var(--app-surface)), var(--app-canvas));
          "
        />
        <div class="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <RouterLink :to="`/careers/${slug}`" class="group inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition hover:text-fg">
            <ArrowLeft :size="15" class="transition group-hover:-translate-x-0.5" aria-hidden="true" /> All open positions
          </RouterLink>
          <div class="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium text-accent-fg">{{ job.department?.name ?? org.name }}</p>
                <span v-for="f in jobFlags(job)" :key="f.label" :class="['rounded-full px-2 py-0.5 text-2xs font-semibold', f.class]">{{ f.label }}</span>
              </div>
              <h1 class="mt-1 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl">{{ job.title }}</h1>
              <p class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-fg-muted">
                <span v-if="job.location" class="inline-flex items-center gap-1.5"><MapPin :size="15" class="text-brand-500" aria-hidden="true" />{{ job.location.name }}</span>
                <span class="inline-flex items-center gap-1.5"><Clock :size="15" class="text-brand-500" aria-hidden="true" />{{ EMPLOYMENT_TYPE_LABELS[job.employmentType] }}</span>
                <span v-if="experience(job.experienceMin, job.experienceMax)" class="inline-flex items-center gap-1.5">
                  <GraduationCap :size="15" class="text-brand-500" aria-hidden="true" />{{ experience(job.experienceMin, job.experienceMax) }}
                </span>
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <AppButton variant="secondary" :icon="copied ? Check : Link2" @click="copyLink">{{ copied ? 'Link copied' : 'Copy link' }}</AppButton>
              <AppButton v-if="!done" size="lg" :icon="Send" class="max-sm:hidden" @click="toApply">Apply now</AppButton>
            </div>
          </div>
        </div>
      </section>

      <div class="mx-auto grid max-w-6xl items-start gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0 space-y-6">
          <article class="card p-6 sm:p-8">
            <h2 class="text-lg font-semibold text-fg">About the role</h2>
            <JobDescription class="mt-3" :text="job.description" />
            <template v-if="job.requirements">
              <h2 class="mt-8 text-lg font-semibold text-fg">What we're looking for</h2>
              <JobDescription class="mt-3" :text="job.requirements" />
            </template>
          </article>

          <!-- Application -->
          <section id="apply" ref="applySection" class="card scroll-mt-24 p-6 sm:p-8" aria-labelledby="apply-title">
            <div v-if="done" class="py-4 text-center" role="status">
              <span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success-soft text-success-fg"><CheckCircle2 :size="34" aria-hidden="true" /></span>
              <h2 id="apply-title" class="mt-4 text-xl font-semibold text-fg">Application sent</h2>
              <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">{{ done }}</p>
              <ol class="mx-auto mt-8 grid max-w-2xl gap-4 text-start sm:grid-cols-3">
                <li v-for="(s, i) in NEXT_STEPS" :key="s.title" class="rounded-xl border border-line bg-surface-muted/40 p-4">
                  <span class="flex items-center gap-2 text-xs font-semibold text-accent-fg"><component :is="s.icon" :size="15" aria-hidden="true" />Step {{ i + 1 }}</span>
                  <p class="mt-2 text-sm font-semibold text-fg">{{ s.title }}</p>
                  <p class="mt-1 text-xs leading-5 text-fg-muted">{{ s.text }}</p>
                </li>
              </ol>
              <AppButton class="mt-8" variant="secondary" :icon="ArrowLeft" :to="`/careers/${slug}`">See other open positions</AppButton>
            </div>

            <form v-else class="space-y-8" novalidate @submit.prevent="apply">
              <div>
                <h2 id="apply-title" class="text-xl font-semibold text-fg">Apply for this position</h2>
                <p class="mt-1 text-sm text-fg-muted">Takes about two minutes. Fields marked <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">with an asterisk</span> are required.</p>
              </div>
              <AppAlert v-if="formError">{{ formError }}</AppAlert>

              <fieldset class="space-y-4">
                <legend class="flex items-center gap-2 text-sm font-semibold text-fg">
                  <span class="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent-fg" aria-hidden="true">1</span> About you
                </legend>
                <div class="grid gap-4 sm:grid-cols-2">
                  <AppInput v-model="form.firstName" label="First name" required autocomplete="given-name" :error="fieldErrors.firstName" />
                  <AppInput v-model="form.lastName" label="Last name" required autocomplete="family-name" :error="fieldErrors.lastName" />
                  <AppInput v-model="form.email" label="Email" type="email" required autocomplete="email" :error="fieldErrors.email" />
                  <AppInput v-model="form.phone" label="Phone" type="tel" autocomplete="tel" :error="fieldErrors.phone" />
                </div>
                <AppInput v-model="form.linkedinUrl" label="LinkedIn profile" placeholder="linkedin.com/in/your-name" autocomplete="url" :error="fieldErrors.linkedinUrl" />
              </fieldset>

              <fieldset class="space-y-3">
                <legend class="flex items-center gap-2 text-sm font-semibold text-fg">
                  <span class="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent-fg" aria-hidden="true">2</span> Resume <span class="text-danger" aria-hidden="true">*</span>
                </legend>
                <div v-if="resume" class="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/40 p-3">
                  <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger-fg" aria-hidden="true"><FileText :size="18" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-fg">{{ resume.name }}</p>
                    <p class="text-xs text-fg-muted">{{ size(resume.size) }} · ready to send</p>
                  </div>
                  <AppButton size="sm" variant="ghost" @click="input?.click()">Replace</AppButton>
                  <AppButton size="sm" variant="ghost" :icon="X" aria-label="Remove resume" @click="resume = null" />
                </div>
                <button
                  v-else
                  type="button"
                  :class="[
                    'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none',
                    dragging ? 'border-brand-500 bg-accent-soft' : 'border-line hover:border-brand-400 hover:bg-surface-muted/40',
                  ]"
                  @click="input?.click()"
                  @dragover.prevent="dragging = true"
                  @dragleave="dragging = false"
                  @drop.prevent="drop"
                >
                  <span class="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-fg" aria-hidden="true"><UploadCloud :size="20" /></span>
                  <span class="text-sm font-medium text-fg">Drop your resume here, or <span class="text-accent-fg underline-offset-2 hover:underline">browse</span></span>
                  <span class="text-xs text-fg-muted">PDF or Word (.docx), up to 5 MB</span>
                </button>
                <input ref="input" type="file" class="sr-only" accept=".pdf,.docx" aria-label="Resume" @change="pick" />
                <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
              </fieldset>

              <fieldset class="space-y-3">
                <legend class="flex items-center gap-2 text-sm font-semibold text-fg">
                  <span class="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent-fg" aria-hidden="true">3</span> Anything else
                </legend>
                <AppTextarea v-model="form.coverNote" label="A note for the hiring team" placeholder="Why this role, your availability, anything you'd like us to know" :rows="4" :maxlength="2000" />
              </fieldset>

              <div class="space-y-4 border-t border-line/70 pt-6">
                <AppCheckbox v-model="form.consent" :label="`I agree that ${org.name} may store and process my data to assess my application.`" />
                <div class="flex flex-wrap items-center gap-4">
                  <AppButton type="submit" size="lg" :icon="Send" :loading="sending" :disabled="!canSend">Send application</AppButton>
                  <p v-if="!canSend" class="text-xs text-fg-muted">Still needed: {{ missing.join(', ') }}</p>
                </div>
              </div>
            </form>
          </section>
        </div>

        <!-- Sidebar -->
        <aside class="space-y-4 lg:sticky lg:top-24">
          <section class="card p-5" aria-labelledby="glance-title">
            <h2 id="glance-title" class="text-sm font-semibold text-fg">At a glance</h2>
            <dl class="mt-4 space-y-3.5">
              <div v-for="f in glance" :key="f.label" class="flex items-start gap-3">
                <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="15" /></span>
                <div class="min-w-0">
                  <dt class="text-xs text-fg-subtle">{{ f.label }}</dt>
                  <dd class="text-sm font-medium text-fg">{{ f.value }}</dd>
                </div>
              </div>
            </dl>
            <AppButton v-if="!done" class="mt-5 w-full" :icon="Send" @click="toApply">Apply now</AppButton>
          </section>

          <section class="card p-5" aria-labelledby="org-title">
            <div class="flex items-center gap-3">
              <img v-if="logo" :src="logo" alt="" class="h-10 w-10 rounded-lg object-contain ring-1 ring-line" />
              <div class="min-w-0">
                <h2 id="org-title" class="truncate text-sm font-semibold text-fg">About {{ org.name }}</h2>
                <p v-if="orgFacts.length" class="truncate text-xs text-fg-muted">{{ orgFacts.join(' · ') }}</p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <AppButton size="sm" variant="secondary" :to="`/careers/${slug}`">All open positions</AppButton>
              <a
                v-if="org.website"
                :href="/^https?:/i.test(org.website) ? org.website : `https://${org.website}`"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm font-medium text-fg-muted transition hover:bg-surface-muted hover:text-fg"
              >
                Website <ArrowUpRight :size="14" aria-hidden="true" />
              </a>
            </div>
          </section>
        </aside>
      </div>

      <!-- Phone: sticky apply bar -->
      <div v-if="!done && !formInView" class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 backdrop-blur-md sm:hidden">
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-fg">{{ job.title }}</p>
            <p class="truncate text-xs text-fg-muted">{{ org.name }}</p>
          </div>
          <AppButton :icon="Send" @click="toApply">Apply</AppButton>
        </div>
      </div>
    </template>
  </CareersShell>
</template>
