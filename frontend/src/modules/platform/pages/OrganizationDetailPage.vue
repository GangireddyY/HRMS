<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Ban, CircleSlash, Mail, RotateCcw, Save } from '@lucide/vue';
import { platformApi } from '@/modules/platform/api/platform.api';
import OrganizationProfileForm from '@/modules/organization/components/OrganizationProfileForm.vue';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppErrorState,
  AppModal,
  AppPageHeader,
  AppSelect,
  AppSkeleton,
  AppTabs,
  AppTextarea,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';
import { changedFields, toProfileFields, type ProfileFields } from '@/modules/organization/utils/profile';
import { membershipTone, organizationTone, statusLabel } from '@/shared/utils/status';

const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const org = useAsync(() => platformApi.organization(id.value));
const plans = useAsync(() => platformApi.plans());
const canManage = computed(() => auth.canPlatform('platform.organizations.manage'));
const tab = ref('overview');
const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
  { key: 'entitlements', label: 'Entitlements' },
];
const busy = ref<string | null>(null);

// Status changes
const statusModal = ref<'suspend' | 'deactivate' | null>(null);
const reason = ref('');
async function changeStatus(kind: 'activate' | 'suspend' | 'deactivate') {
  busy.value = kind;
  try {
    org.data.value =
      kind === 'activate' ? await platformApi.activate(id.value) : kind === 'suspend' ? await platformApi.suspend(id.value, reason.value.trim()) : await platformApi.deactivate(id.value, reason.value.trim());
    statusModal.value = null;
    reason.value = '';
    feedback.success(`Organization ${kind === 'activate' ? 'activated' : kind === 'suspend' ? 'suspended' : 'deactivated'}`);
  } catch (e) {
    feedback.error('Status change failed', e);
  } finally {
    busy.value = null;
  }
}

// Plan
const planId = ref<string | null>(null);
watch(org.data, (o) => o && (planId.value = o.plan.id), { immediate: true });
const planOptions = computed(() => (plans.data.value ?? []).map((p) => ({ label: `${p.name}${p.isActive ? '' : ' (inactive)'}`, value: p.id, disabled: !p.isActive })));
async function savePlan() {
  busy.value = 'plan';
  try {
    org.data.value = await platformApi.updateOrganization(id.value, { planId: planId.value });
    feedback.success('Plan updated');
  } catch (e) {
    feedback.error('Could not change plan', e);
  } finally {
    busy.value = null;
  }
}

async function resend(membershipId: string) {
  busy.value = `resend:${membershipId}`;
  try {
    await platformApi.resendAdminInvitation(id.value, membershipId);
    feedback.success('Invitation resent');
  } catch (e) {
    feedback.error('Could not resend invitation', e);
  } finally {
    busy.value = null;
  }
}

// Profile
const initial = computed<ProfileFields | null>(() => (org.data.value ? toProfileFields(org.data.value) : null));
const profile = ref<ProfileFields | null>(null);
watch(initial, (v) => (profile.value = v ? { ...v } : null), { immediate: true });
const profileChanges = computed(() => (initial.value && profile.value ? changedFields(initial.value, profile.value) : {}));
const profileErrors = useFormErrors();
async function saveProfile() {
  profileErrors.reset();
  busy.value = 'profile';
  try {
    org.data.value = await platformApi.updateOrganization(id.value, profileChanges.value);
    feedback.success('Profile saved');
  } catch (e) {
    profileErrors.handle(e, 'Could not save profile');
  } finally {
    busy.value = null;
  }
}

// Entitlements
type OverrideChoice = 'plan' | 'on' | 'off';
const overrides = ref<Record<string, OverrideChoice>>({});
watch(
  org.data,
  (o) => {
    if (!o) return;
    overrides.value = Object.fromEntries(o.modules.filter((m) => !m.core).map((m) => {
      const ov = o.featureOverrides.find((f) => f.featureKey === m.key);
      return [m.key, ov ? (ov.enabled ? 'on' : 'off') : 'plan'];
    }));
  },
  { immediate: true },
);
const overrideOptions = [
  { label: 'Follow plan', value: 'plan' as OverrideChoice },
  { label: 'Force enable', value: 'on' as OverrideChoice },
  { label: 'Force disable', value: 'off' as OverrideChoice },
];
const planFeatures = computed(() => new Set(plans.data.value?.find((p) => p.id === org.data.value?.plan.id)?.featureKeys ?? []));
async function saveEntitlements() {
  busy.value = 'features';
  try {
    org.data.value = await platformApi.setFeatures(
      id.value,
      Object.entries(overrides.value).map(([featureKey, choice]) => ({ featureKey, enabled: choice === 'plan' ? null : choice === 'on' })),
    );
    feedback.success('Entitlements saved');
  } catch (e) {
    feedback.error('Could not save entitlements', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="org.loading.value && !org.data.value" :lines="8" />
    <AppErrorState v-else-if="org.error.value" :error="org.error.value" title="Could not load organization" @retry="org.run" />
    <template v-else-if="org.data.value">
      <AppPageHeader :title="org.data.value.name" :description="`${org.data.value.slug} · created ${formatDateTime(org.data.value.createdAt)}`" back="/platform/organizations" back-label="Organizations">
        <template #badges><AppBadge :tone="organizationTone[org.data.value.status]" dot>{{ statusLabel(org.data.value.status) }}</AppBadge></template>
        <template v-if="canManage" #actions>
          <AppButton v-if="org.data.value.status !== 'ACTIVE'" :icon="RotateCcw" :loading="busy === 'activate'" @click="changeStatus('activate')">Activate</AppButton>
          <AppButton v-if="org.data.value.status === 'ACTIVE'" variant="danger" :icon="Ban" @click="statusModal = 'suspend'">Suspend</AppButton>
          <AppButton v-if="org.data.value.status !== 'DEACTIVATED'" variant="secondary" :icon="CircleSlash" @click="statusModal = 'deactivate'">Deactivate</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="org.data.value.suspensionReason && org.data.value.status !== 'ACTIVE'" class="mb-4">
        {{ org.data.value.status === 'SUSPENDED' ? 'Suspended' : 'Deactivated' }} {{ formatDateTime(org.data.value.suspendedAt) }}: {{ org.data.value.suspensionReason }}
      </AppAlert>

      <AppTabs v-model="tab" :tabs="tabs">
        <div v-if="tab === 'overview'" class="grid items-start gap-4 lg:grid-cols-3">
          <AppCard title="Subscription">
            <AppSelect v-model="planId" label="Plan" :options="planOptions" :disabled="!canManage" />
            <div v-if="canManage" class="mt-4 flex justify-end">
              <AppButton size="sm" :loading="busy === 'plan'" :disabled="planId === org.data.value.plan.id" @click="savePlan">Change plan</AppButton>
            </div>
            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-fg-muted">Active users</dt><dd class="tabular-nums">{{ org.data.value.members.ACTIVE ?? 0 }}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Invited</dt><dd class="tabular-nums">{{ org.data.value.members.INVITED ?? 0 }}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Suspended</dt><dd class="tabular-nums">{{ org.data.value.members.SUSPENDED ?? 0 }}</dd></div>
            </dl>
          </AppCard>
          <AppCard class="lg:col-span-2" title="Organization administrators" :padded="false">
            <ul class="divide-y divide-line">
              <li v-for="a in org.data.value.admins" :key="a.membershipId" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p class="text-sm font-medium">{{ a.firstName }} {{ a.lastName }}</p>
                  <p class="text-xs text-fg-muted">{{ a.email }} · last sign-in {{ formatDateTime(a.lastLoginAt) }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <AppBadge :tone="membershipTone[a.status]">{{ statusLabel(a.status) }}</AppBadge>
                  <AppButton v-if="a.status === 'INVITED' && canManage" size="sm" variant="secondary" :icon="Mail" :loading="busy === `resend:${a.membershipId}`" @click="resend(a.membershipId)">Resend</AppButton>
                </div>
              </li>
              <li v-if="!org.data.value.admins.length" class="px-4 py-4 text-center text-sm text-fg-muted">No administrators.</li>
            </ul>
          </AppCard>
        </div>

        <AppCard v-else-if="tab === 'profile'">
          <form v-if="profile" novalidate @submit.prevent="saveProfile">
            <AppAlert v-if="profileErrors.formError.value" class="mb-4">{{ profileErrors.formError.value }}</AppAlert>
            <OrganizationProfileForm v-model="profile" :errors="profileErrors.fieldErrors.value" :disabled="!canManage" />
            <div v-if="canManage" class="mt-4 flex justify-end border-t border-line pt-4">
              <AppButton type="submit" :icon="Save" :loading="busy === 'profile'" :disabled="!Object.keys(profileChanges).length">Save changes</AppButton>
            </div>
          </form>
        </AppCard>

        <AppCard v-else title="Module entitlements" description="Overrides apply on top of the plan for this organization only.">
          <template v-if="canManage" #actions><AppButton size="sm" :icon="Save" :loading="busy === 'features'" @click="saveEntitlements">Save entitlements</AppButton></template>
          <ul class="divide-y divide-line">
            <li v-for="m in org.data.value.modules.filter((x) => !x.core)" :key="m.key" class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p class="text-sm font-medium">{{ m.name }}</p>
                <p class="text-xs text-fg-muted">Plan: {{ planFeatures.has(m.key) ? 'included' : 'not included' }} · Effective: <AppBadge :tone="m.entitled ? 'success' : 'neutral'">{{ m.entitled ? 'Enabled' : 'Disabled' }}</AppBadge></p>
              </div>
              <div class="w-44"><AppSelect v-model="overrides[m.key]" :options="overrideOptions" :disabled="!canManage" :aria-label="`Override for ${m.name}`" /></div>
            </li>
          </ul>
        </AppCard>
      </AppTabs>

      <AppModal :open="!!statusModal" :title="statusModal === 'suspend' ? 'Suspend organization' : 'Deactivate organization'" description="All users of this organization are signed out immediately." size="sm" @close="statusModal = null">
        <AppTextarea v-model="reason" label="Reason" required :maxlength="500" help="Visible to platform administrators and recorded in the audit log." />
        <template #footer>
          <AppButton variant="secondary" @click="statusModal = null">Cancel</AppButton>
          <AppButton variant="danger" :loading="busy === statusModal" :disabled="reason.trim().length < 3" @click="changeStatus(statusModal!)">
            {{ statusModal === 'suspend' ? 'Suspend' : 'Deactivate' }}
          </AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
