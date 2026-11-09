<script setup lang="ts">
import { computed } from 'vue';
import { AppInput, AppSelect } from '@/shared/components';
import { COMPANY_SIZE_OPTIONS, COUNTRY_OPTIONS, CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, MONTH_OPTIONS, timezoneOptions } from '@/shared/utils/options';
import type { ProfileFields } from '@/modules/organization/utils/profile';

/** Company, contact and regional fields. `anchorPrefix` gives each group an id (`<prefix>company|contact|regional`) for in-page navigation. */
const props = defineProps<{ errors: Record<string, string>; disabled?: boolean; anchorPrefix?: string }>();
const model = defineModel<ProfileFields>({ required: true });
const timezones = computed(() => timezoneOptions(model.value.timezone));
const anchor = (key: string) => (props.anchorPrefix ? `${props.anchorPrefix}${key}` : undefined);
</script>

<template>
  <fieldset :disabled="disabled" class="divide-y divide-line/70" aria-label="Organization profile">
    <div :id="anchor('company')" class="grid scroll-mt-20 lg:scroll-mt-4 gap-x-10 gap-y-4 pb-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <p class="text-sm font-semibold text-fg">Company</p>
        <p class="mt-1 text-sm text-fg-muted">How your organization appears across the product and on documents.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        <AppInput v-model="model.name" label="Display name" required :error="errors.name" />
        <AppInput v-model="model.legalName" label="Legal name" :error="errors.legalName" />
        <AppInput v-model="model.industry" label="Industry" :error="errors.industry" />
        <AppSelect v-model="model.companySize" label="Company size" placeholder="Select…" :options="COMPANY_SIZE_OPTIONS" :error="errors.companySize" />
        <AppInput v-model="model.registrationNumber" label="Registration number (CIN)" :error="errors.registrationNumber" />
        <AppInput v-model="model.taxId" label="Tax ID (PAN / TAN / GSTIN)" :error="errors.taxId" />
      </div>
    </div>
    <div :id="anchor('contact')" class="grid scroll-mt-20 lg:scroll-mt-4 gap-x-10 gap-y-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <p class="text-sm font-semibold text-fg">Contact &amp; address</p>
        <p class="mt-1 text-sm text-fg-muted">Registered office and the contact details employees and partners see.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        <AppInput v-model="model.email" label="Email" type="email" :error="errors.email" />
        <AppInput v-model="model.phone" label="Phone" type="tel" :error="errors.phone" />
        <AppInput v-model="model.website" label="Website" placeholder="https://" :error="errors.website" class="sm:col-span-2" />
        <AppInput v-model="model.addressLine1" label="Address line 1" :error="errors.addressLine1" />
        <AppInput v-model="model.addressLine2" label="Address line 2" :error="errors.addressLine2" />
        <AppInput v-model="model.city" label="City" :error="errors.city" />
        <AppInput v-model="model.state" label="State / province" :error="errors.state" />
        <AppInput v-model="model.postalCode" label="Postal code" :error="errors.postalCode" />
        <AppSelect v-model="model.country" label="Country" :options="COUNTRY_OPTIONS" :error="errors.country" />
      </div>
    </div>
    <div :id="anchor('regional')" class="grid scroll-mt-20 lg:scroll-mt-4 gap-x-10 gap-y-4 pt-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <p class="text-sm font-semibold text-fg">Regional settings</p>
        <p class="mt-1 text-sm text-fg-muted">Defaults for dates, money and the financial year.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        <AppSelect v-model="model.timezone" label="Time zone" :options="timezones" :error="errors.timezone" />
        <AppSelect v-model="model.currency" label="Currency" :options="CURRENCY_OPTIONS" :error="errors.currency" />
        <AppSelect v-model="model.dateFormat" label="Date format" :options="DATE_FORMAT_OPTIONS" :error="errors.dateFormat" />
        <AppSelect v-model="model.fiscalYearStartMonth" label="Financial year starts" :options="MONTH_OPTIONS" :error="errors.fiscalYearStartMonth" />
      </div>
    </div>
  </fieldset>
</template>
