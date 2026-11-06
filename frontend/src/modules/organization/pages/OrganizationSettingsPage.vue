<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Save } from '@lucide/vue';
import { organizationApi } from '@/modules/organization/api/organization.api';
import type { SecurityPolicy } from '@/modules/organization/types';
import OrganizationLogoUploader from '@/modules/organization/components/OrganizationLogoUploader.vue';
import OrganizationProfileForm from '@/modules/organization/components/OrganizationProfileForm.vue';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppErrorState,
  AppInput,
  AppPageHeader,
  AppSkeleton,
  AppSwitch,
  AppTabs,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';
import { changedFields, toProfileFields, type ProfileFields } from '@/modules/organization/utils/profile';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const tab = ref('profile');
const tabs = [
  { key: 'profile', label: 'Company profile' },
  { key: 'security', label: 'Security policy' },
  { key: 'subscription', label: 'Subscription' },
];

// Profile
const org = useAsync(() => organizationApi.get());
const initial = computed<ProfileFields | null>(() => (org.data.value ? toProfileFields(org.data.value) : null));
const profile = ref<ProfileFields | null>(null);
const profileErrors = useFormErrors();
const savingProfile = ref(false);
const canEditProfile = computed(() => auth.can('organization.update'));
const profileChanges = computed(() => (initial.value && profile.value ? changedFields(initial.value, profile.value) : {}));
watch(initial, (v) => (profile.value = v ? { ...v } : null), { immediate: true });

async function saveProfile() {
  profileErrors.reset();
  savingProfile.value = true;
  try {
    org.data.value = await organizationApi.update(profileChanges.value);
    await auth.loadContext();
    feedback.success('Organization profile saved');
  } catch (e) {
    profileErrors.handle(e, 'Could not save profile');
  } finally {
    savingProfile.value = false;
  }
}

// Security policy
const policy = useAsync(() => organizationApi.securityPolicy());
const policyForm = reactive<Partial<SecurityPolicy>>({});
const policyErrors = useFormErrors();
const savingPolicy = ref(false);
const canEditPolicy = computed(() => auth.can('organization.security.manage'));
watch(policy.data, (p) => p && Object.assign(policyForm, p), { immediate: true });

async function savePolicy() {
  policyErrors.reset();
  if (policyForm.mfaRequired && !policy.data.value?.mfaRequired) {
    const ok = await feedback.confirm({
      title: 'Require two-factor authentication?',
      message: 'Users without 2FA will be restricted to the security page until they enrol.',
      confirmLabel: 'Require 2FA',
    });
    if (!ok) return;
  }
  savingPolicy.value = true;
  try {
    const { id: _id, updatedAt: _u, ...body } = policyForm as SecurityPolicy;
    policy.data.value = await organizationApi.updateSecurityPolicy(body);
    await auth.loadContext();
    feedback.success('Security policy saved');
  } catch (e) {
    policyErrors.handle(e, 'Could not save policy');
  } finally {
    savingPolicy.value = false;
  }
}

// Subscription
const subscription = useAsync(() => organizationApi.subscription(), { immediate: false });
watch(tab, (t) => {
  if (t === 'subscription' && !subscription.data.value) void subscription.run();
});
</script>

<template>
  <div>
    <AppPageHeader title="Organization settings" description="Company profile, regional defaults, security policy and subscription." />
    <AppTabs v-model="tab" :tabs="tabs">
      <!-- Profile -->
      <AppCard v-if="tab === 'profile'">
        <AppSkeleton v-if="org.loading.value && !org.data.value" :lines="8" />
        <AppErrorState v-else-if="org.error.value" :error="org.error.value" @retry="org.run" />
        <form v-else-if="profile" novalidate @submit.prevent="saveProfile">
          <AppAlert v-if="profileErrors.formError.value" class="mb-4">{{ profileErrors.formError.value }}</AppAlert>
          <div class="grid gap-x-10 gap-y-4 border-b border-line/70 pb-8 mb-8 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <p class="text-sm font-semibold text-fg">Logo</p>
              <p class="mt-1 text-[13px] text-fg-muted">Shown at the top of the sidebar for everyone in your organization. Changes apply immediately.</p>
            </div>
            <OrganizationLogoUploader
              :logo-url="org.data.value?.logoUrl ?? null"
              :organization-name="org.data.value?.name ?? ''"
              :disabled="!canEditProfile"
            />
          </div>
          <OrganizationProfileForm v-model="profile" :errors="profileErrors.fieldErrors.value" :disabled="!canEditProfile" />
          <div v-if="canEditProfile" class="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
            <span class="text-xs text-fg-subtle">Last updated {{ formatDateTime(org.data.value?.updatedAt) }}</span>
            <AppButton type="submit" :icon="Save" :loading="savingProfile" :disabled="!Object.keys(profileChanges).length">Save changes</AppButton>
          </div>
        </form>
      </AppCard>

      <!-- Security -->
      <div v-else-if="tab === 'security'">
        <AppSkeleton v-if="policy.loading.value && !policy.data.value" :lines="8" />
        <AppErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.run" />
        <form v-else-if="policy.data.value" class="space-y-6" novalidate @submit.prevent="savePolicy">
          <AppAlert v-if="policyErrors.formError.value">{{ policyErrors.formError.value }}</AppAlert>
          <fieldset :disabled="!canEditPolicy" class="grid gap-6 lg:grid-cols-2">
            <AppCard title="Password requirements">
              <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                  <AppInput v-model="policyForm.passwordMinLength" type="number" label="Minimum length" :min="8" :max="128" :error="policyErrors.fieldErrors.value.passwordMinLength" />
                  <AppInput v-model="policyForm.passwordHistoryCount" type="number" label="Password history" help="Previous passwords that cannot be reused" :min="0" :max="24" :error="policyErrors.fieldErrors.value.passwordHistoryCount" />
                </div>
                <AppInput v-model="policyForm.passwordMaxAgeDays" type="number" label="Maximum age (days)" help="0 = passwords never expire" :min="0" :max="365" :error="policyErrors.fieldErrors.value.passwordMaxAgeDays" />
                <AppSwitch v-model="policyForm.passwordRequireUppercase" label="Require uppercase letter" />
                <AppSwitch v-model="policyForm.passwordRequireLowercase" label="Require lowercase letter" />
                <AppSwitch v-model="policyForm.passwordRequireNumber" label="Require number" />
                <AppSwitch v-model="policyForm.passwordRequireSymbol" label="Require symbol" />
              </div>
            </AppCard>
            <div class="space-y-6">
              <AppCard title="Account lockout">
                <div class="grid grid-cols-2 gap-4">
                  <AppInput v-model="policyForm.lockoutThreshold" type="number" label="Failed attempts" :min="3" :max="20" :error="policyErrors.fieldErrors.value.lockoutThreshold" />
                  <AppInput v-model="policyForm.lockoutDurationMinutes" type="number" label="Lockout (minutes)" :min="1" :max="1440" :error="policyErrors.fieldErrors.value.lockoutDurationMinutes" />
                </div>
              </AppCard>
              <AppCard title="Sessions">
                <div class="grid grid-cols-2 gap-4">
                  <AppInput v-model="policyForm.sessionIdleTimeoutMinutes" type="number" label="Idle timeout (min)" :min="5" :max="1440" :error="policyErrors.fieldErrors.value.sessionIdleTimeoutMinutes" />
                  <AppInput v-model="policyForm.sessionMaxLifetimeHours" type="number" label="Max lifetime (hours)" :min="1" :max="720" :error="policyErrors.fieldErrors.value.sessionMaxLifetimeHours" />
                </div>
              </AppCard>
              <AppCard title="Multi-factor authentication">
                <AppSwitch v-model="policyForm.mfaRequired" label="Require 2FA for all users" description="Users must enrol an authenticator app before accessing HRMS." />
              </AppCard>
            </div>
          </fieldset>
          <div v-if="canEditPolicy" class="flex justify-end"><AppButton type="submit" :icon="Save" :loading="savingPolicy">Save policy</AppButton></div>
        </form>
      </div>

      <!-- Subscription -->
      <div v-else>
        <AppSkeleton v-if="subscription.loading.value" :lines="6" />
        <AppErrorState v-else-if="subscription.error.value" :error="subscription.error.value" @retry="subscription.run" />
        <div v-else-if="subscription.data.value" class="space-y-6">
          <section class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-card">
            <div class="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <div class="relative flex flex-wrap items-end justify-between gap-6">
              <div>
                <p class="text-sm font-medium text-white/70">Current plan</p>
                <p class="mt-1 text-3xl font-semibold tracking-tight">{{ subscription.data.value.plan.name }}</p>
                <p class="mt-1 max-w-md text-sm text-white/75">{{ subscription.data.value.plan.description }}</p>
              </div>
              <div class="w-full max-w-xs">
                <div class="flex items-baseline justify-between text-sm">
                  <span class="text-white/70">Users</span>
                  <span class="font-semibold tabular-nums">
                    {{ subscription.data.value.userCount }}<span class="font-normal text-white/70"> / {{ subscription.data.value.plan.maxUsers ?? 'Unlimited' }}</span>
                  </span>
                </div>
                <div
                  class="mt-2 h-2 overflow-hidden rounded-full bg-white/20"
                  role="progressbar"
                  aria-label="User seats used"
                  :aria-valuenow="subscription.data.value.userCount"
                  :aria-valuemax="subscription.data.value.plan.maxUsers ?? undefined"
                >
                  <div
                    class="h-full rounded-full bg-white transition-[width] duration-500"
                    :style="{ width: subscription.data.value.plan.maxUsers ? `${Math.min(100, (subscription.data.value.userCount / subscription.data.value.plan.maxUsers) * 100)}%` : '100%' }"
                  />
                </div>
              </div>
            </div>
          </section>
          <AppCard title="Modules" description="Modules included in your subscription. Contact your platform administrator to change entitlements.">
            <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              <li
                v-for="m in subscription.data.value.modules"
                :key="m.key"
                :class="['rounded-xl border p-4 transition', m.entitled ? 'border-line bg-surface' : 'border-dashed border-line bg-surface-muted/40 opacity-75']"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-medium text-fg">{{ m.name }}</p>
                  <AppBadge :tone="m.entitled ? 'success' : 'neutral'">{{ m.core ? 'Core' : m.entitled ? 'Included' : 'Not included' }}</AppBadge>
                </div>
                <p class="mt-1 text-xs text-fg-muted">{{ m.description }}</p>
              </li>
            </ul>
          </AppCard>
        </div>
      </div>
    </AppTabs>
  </div>
</template>
