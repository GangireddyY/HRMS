<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { Plan, PlatformOrgDetail } from '@/modules/platform/types';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { COMPANY_SIZE_OPTIONS, COUNTRY_OPTIONS, CURRENCY_OPTIONS, timezoneOptions } from '@/shared/utils/options';

const props = defineProps<{ open: boolean; plans: Plan[] }>();
const emit = defineEmits<{ close: []; created: [org: PlatformOrgDetail] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const timezones = timezoneOptions();

const blank = () => ({
  name: '',
  planId: null as string | null,
  country: 'IN',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  companySize: null as string | null,
  email: '',
  admin: { email: '', firstName: '', lastName: '' },
});
const form = reactive(blank());
const planOptions = computed(() => props.plans.filter((p) => p.isActive).map((p) => ({ label: p.name, value: p.id })));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, blank());
    form.planId = props.plans.find((p) => p.code === 'growth')?.id ?? planOptions.value[0]?.value ?? null;
  },
);

async function submit() {
  reset();
  saving.value = true;
  try {
    const org = await platformApi.createOrganization({
      ...form,
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      companySize: form.companySize ?? undefined,
      admin: { email: form.admin.email.trim(), firstName: form.admin.firstName.trim(), lastName: form.admin.lastName.trim() },
    });
    emit('created', org);
  } catch (e) {
    handle(e, 'Could not create organization');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="New organization" description="Provisions roles and security policy, then invites the first administrator." size="lg" @close="emit('close')">
    <form id="create-org" class="space-y-5" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.name" label="Organization name" required autofocus :error="fieldErrors.name" class="sm:col-span-2" />
        <AppSelect v-model="form.planId" label="Plan" :options="planOptions" required :error="fieldErrors.planId" />
        <AppSelect v-model="form.companySize" label="Company size" placeholder="Select…" :options="COMPANY_SIZE_OPTIONS" :error="fieldErrors.companySize" />
        <AppSelect v-model="form.country" label="Country" :options="COUNTRY_OPTIONS" :error="fieldErrors.country" />
        <AppSelect v-model="form.currency" label="Currency" :options="CURRENCY_OPTIONS" :error="fieldErrors.currency" />
        <AppSelect v-model="form.timezone" label="Time zone" :options="timezones" :error="fieldErrors.timezone" />
        <AppInput v-model="form.email" label="Company email" type="email" :error="fieldErrors.email" />
      </div>
      <fieldset class="rounded-xl border border-line p-4">
        <legend class="px-1 text-sm font-semibold text-fg">First administrator</legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.admin.firstName" label="First name" required :error="fieldErrors['admin.firstName']" />
          <AppInput v-model="form.admin.lastName" label="Last name" required :error="fieldErrors['admin.lastName']" />
          <AppInput v-model="form.admin.email" label="Email" type="email" required :error="fieldErrors['admin.email']" class="sm:col-span-2" />
        </div>
      </fieldset>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="create-org" :loading="saving" :disabled="!form.name.trim() || !form.planId || !form.admin.email || !form.admin.firstName || !form.admin.lastName">
        Create &amp; invite
      </AppButton>
    </template>
  </AppModal>
</template>
