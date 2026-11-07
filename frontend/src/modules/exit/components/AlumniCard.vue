<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Handshake } from '@lucide/vue';
import { alumniApi } from '@/modules/exit/api/exit.api';
import { AppAlert, AppButton, AppCard, AppInput, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Former employees: join the alumni network and keep their contact details and current job up to date. */
const feedback = useFeedbackStore();
const mine = useAsync(() => alumniApi.mine());
const form = reactive({ optedIn: true, personalEmail: '', phone: '', linkedinUrl: '', currentCompany: '', currentTitle: '', city: '', openToOpportunities: false });
watch(
  () => mine.data.value,
  (m) => {
    const p = m?.profile;
    if (!p) return;
    Object.assign(form, {
      optedIn: m!.joined ? p.optedIn : true,
      personalEmail: p.personalEmail ?? '',
      phone: p.phone ?? '',
      linkedinUrl: p.linkedinUrl ?? '',
      currentCompany: p.currentCompany ?? '',
      currentTitle: p.currentTitle ?? '',
      city: p.city ?? '',
      openToOpportunities: p.openToOpportunities,
    });
  },
);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const busy = ref(false);
async function save() {
  reset();
  busy.value = true;
  try {
    const n = (v: string) => v.trim() || null;
    mine.data.value = await alumniApi.update({
      optedIn: form.optedIn,
      personalEmail: n(form.personalEmail),
      phone: n(form.phone),
      linkedinUrl: n(form.linkedinUrl),
      currentCompany: n(form.currentCompany),
      currentTitle: n(form.currentTitle),
      city: n(form.city),
      openToOpportunities: form.optedIn && form.openToOpportunities,
    });
    feedback.success(form.optedIn ? 'Alumni profile saved' : 'You have left the alumni network');
  } catch (e) {
    handle(e, 'Could not save your alumni profile');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="4" />
  <AppCard v-else-if="mine.data.value?.eligible" title="Stay in touch" :icon="Handshake" description="Join the alumni network so we can keep you posted about reunions, referrals and openings.">
    <form id="alumni-form" class="max-w-3xl space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSwitch v-model="form.optedIn" label="Join the alumni network" description="HR sees the details below only while you are in the network." />
      <template v-if="form.optedIn">
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.personalEmail" label="Personal email" type="email" :maxlength="254" :error="fieldErrors.personalEmail" />
          <AppInput v-model="form.phone" label="Phone" inputmode="tel" :maxlength="20" :error="fieldErrors.phone" />
          <AppInput v-model="form.currentCompany" label="Current company" :maxlength="200" :error="fieldErrors.currentCompany" />
          <AppInput v-model="form.currentTitle" label="Current role" :maxlength="200" :error="fieldErrors.currentTitle" />
          <AppInput v-model="form.city" label="City" :maxlength="100" :error="fieldErrors.city" />
          <AppInput v-model="form.linkedinUrl" label="LinkedIn profile" placeholder="https://linkedin.com/in/name" :maxlength="255" :error="fieldErrors.linkedinUrl" />
        </div>
        <AppSwitch v-model="form.openToOpportunities" label="Open to opportunities" description="Happy to hear about openings and coming back." />
      </template>
    </form>
    <template #footer>
      <div class="flex justify-end"><AppButton type="submit" form="alumni-form" :loading="busy">Save</AppButton></div>
    </template>
  </AppCard>
</template>
