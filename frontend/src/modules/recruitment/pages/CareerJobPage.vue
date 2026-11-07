<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, FileUp, MapPin } from '@lucide/vue';
import { RESUME_MAX_BYTES } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { careersApi } from '@/modules/recruitment/api/recruitment.api';
import { experience } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppButton, AppCheckbox, AppErrorState, AppInput, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Public job page with the application form (resume required, consent required). */
const route = useRoute();
const slug = computed(() => String(route.params.slug));
const jobId = computed(() => String(route.params.jobId));
const data = useAsync(() => careersApi.job(slug.value, jobId.value));

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ firstName: '', lastName: '', email: '', phone: '', linkedinUrl: '', coverNote: '', consent: false });
const resume = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const sending = ref(false);
const done = ref<string | null>(null);

function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  if (f.size > RESUME_MAX_BYTES) {
    fieldErrors.value = { ...fieldErrors.value, file: 'The resume must be 5 MB or smaller' };
    return;
  }
  fieldErrors.value = { ...fieldErrors.value, file: '' };
  resume.value = f;
}
const canSend = computed(() => !!form.firstName.trim() && !!form.lastName.trim() && form.email.includes('@') && !!resume.value && form.consent);

async function apply() {
  reset();
  sending.value = true;
  try {
    const r = await careersApi.apply(slug.value, jobId.value, resume.value!, { ...form, consent: String(form.consent), phone: form.phone || null, linkedinUrl: form.linkedinUrl || null, coverNote: form.coverNote || null });
    done.value = r.message;
  } catch (e) {
    handle(e, 'Your application could not be sent');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <div class="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <RouterLink :to="`/careers/${slug}`" class="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">← All open positions</RouterLink>
      <AppSkeleton v-if="data.loading.value && !data.data.value" class="mt-4" :lines="8" />
      <AppErrorState v-else-if="data.error.value" class="mt-4" :error="data.error.value" title="This position isn't open" />
      <template v-else-if="data.data.value">
        <header class="mt-4 mb-4">
          <p class="text-sm text-fg-muted">{{ data.data.value.organization.name }}</p>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight text-fg">{{ data.data.value.job.title }}</h1>
          <p class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <span v-if="data.data.value.job.department">{{ data.data.value.job.department.name }}</span>
            <span v-if="data.data.value.job.location" class="inline-flex items-center gap-1"><MapPin :size="14" aria-hidden="true" />{{ data.data.value.job.location.name }}</span>
            <span>{{ EMPLOYMENT_TYPE_LABELS[data.data.value.job.employmentType] }}</span>
            <span v-if="experience(data.data.value.job.experienceMin, data.data.value.job.experienceMax)">{{ experience(data.data.value.job.experienceMin, data.data.value.job.experienceMax) }}</span>
          </p>
        </header>
        <section class="rounded-2xl bg-surface p-4 ring-1 ring-line">
          <h2 class="text-lg font-semibold text-fg">About the role</h2>
          <p class="mt-2 whitespace-pre-line text-fg-muted">{{ data.data.value.job.description }}</p>
          <template v-if="data.data.value.job.requirements">
            <h2 class="mt-4 text-lg font-semibold text-fg">What we're looking for</h2>
            <p class="mt-2 whitespace-pre-line text-fg-muted">{{ data.data.value.job.requirements }}</p>
          </template>
        </section>

        <section class="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
          <div v-if="done" class="flex flex-col items-center py-4 text-center">
            <CheckCircle2 :size="40" class="text-emerald-500" aria-hidden="true" />
            <p class="mt-3 text-lg font-semibold text-fg">Application sent</p>
            <p class="mt-1 max-w-md text-sm text-fg-muted">{{ done }}</p>
          </div>
          <form v-else class="space-y-4" novalidate @submit.prevent="apply">
            <h2 class="text-lg font-semibold text-fg">Apply for this position</h2>
            <AppAlert v-if="formError">{{ formError }}</AppAlert>
            <div class="grid gap-4 sm:grid-cols-2">
              <AppInput v-model="form.firstName" label="First name" required autocomplete="given-name" :error="fieldErrors.firstName" />
              <AppInput v-model="form.lastName" label="Last name" required autocomplete="family-name" :error="fieldErrors.lastName" />
              <AppInput v-model="form.email" label="Email" type="email" required autocomplete="email" :error="fieldErrors.email" />
              <AppInput v-model="form.phone" label="Phone" type="tel" autocomplete="tel" :error="fieldErrors.phone" />
            </div>
            <AppInput v-model="form.linkedinUrl" label="LinkedIn profile" placeholder="linkedin.com/in/name" :error="fieldErrors.linkedinUrl" />
            <div>
              <p class="mb-1.5 text-sm font-medium text-fg">Resume <span class="text-red-500" aria-hidden="true">*</span></p>
              <button type="button" class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-4 text-left transition hover:border-brand-400" @click="input?.click()">
                <FileUp :size="20" class="text-fg-subtle" aria-hidden="true" />
                <span class="text-sm" :class="resume ? 'font-medium text-fg' : 'text-fg-muted'">{{ resume ? resume.name : 'PDF or Word (.docx), up to 5 MB' }}</span>
              </button>
              <input ref="input" type="file" class="sr-only" accept=".pdf,.docx" aria-label="Resume" @change="pick" />
              <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
            </div>
            <AppTextarea v-model="form.coverNote" label="Anything you'd like to add?" :rows="3" :maxlength="2000" />
            <AppCheckbox v-model="form.consent" :label="`I agree that ${data.data.value.organization.name} may store and process my data to assess my application.`" />
            <AppButton type="submit" size="lg" :loading="sending" :disabled="!canSend">Send application</AppButton>
          </form>
        </section>
      </template>
    </div>
  </div>
</template>
