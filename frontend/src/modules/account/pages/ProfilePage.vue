<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Save } from '@lucide/vue';
import { authApi } from '@/modules/auth/api/auth.api';
import MyEmploymentCard from '@/modules/people/components/MyEmploymentCard.vue';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppInput, AppPageHeader } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ firstName: '', lastName: '', phone: '' });

watch(
  () => auth.user,
  (u) => {
    if (!u) return;
    form.firstName = u.firstName;
    form.lastName = u.lastName;
    form.phone = u.phone ?? '';
  },
  { immediate: true },
);

const dirty = computed(() => !!auth.user && (form.firstName !== auth.user.firstName || form.lastName !== auth.user.lastName || form.phone !== (auth.user.phone ?? '')));

async function save() {
  reset();
  saving.value = true;
  try {
    await authApi.updateProfile({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || null });
    await auth.loadContext();
    feedback.success('Profile updated');
  } catch (e) {
    handle(e, 'Could not update profile');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="My profile" description="Your account details. Employment details are managed by HR." />
    <div class="grid items-start gap-6 lg:grid-cols-3">
      <AppCard class="lg:col-span-2" title="Personal details">
        <form class="space-y-4" novalidate @submit.prevent="save">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="form.firstName" label="First name" required autocomplete="given-name" :error="fieldErrors.firstName" />
            <AppInput v-model="form.lastName" label="Last name" required autocomplete="family-name" :error="fieldErrors.lastName" />
          </div>
          <AppInput :model-value="auth.user?.email" label="Email" disabled help="Contact your administrator to change your sign-in email." />
          <AppInput v-model="form.phone" label="Phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210" :error="fieldErrors.phone" />
          <div class="flex justify-end">
            <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!dirty || !form.firstName.trim() || !form.lastName.trim()">Save changes</AppButton>
          </div>
        </form>
      </AppCard>
      <AppCard title="Account">
        <div class="flex items-center gap-3">
          <AppAvatar :name="`${auth.user?.firstName} ${auth.user?.lastName}`" size="lg" />
          <div class="min-w-0">
            <p class="truncate font-medium text-fg">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</p>
            <p class="truncate text-sm text-fg-muted">{{ auth.user?.email }}</p>
          </div>
        </div>
        <dl class="mt-5 space-y-3 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-fg-muted">Organization</dt><dd class="text-right text-fg">{{ auth.organization?.name ?? '—' }}</dd></div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-muted">Roles</dt>
            <dd class="flex flex-wrap justify-end gap-1">
              <AppBadge v-for="r in auth.context?.roles" :key="r.id" tone="brand">{{ r.name }}</AppBadge>
              <AppBadge v-if="auth.isPlatformAdmin" tone="warning">Super Admin</AppBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-3"><dt class="text-fg-muted">Last sign-in</dt><dd class="text-fg">{{ formatDateTime(auth.user?.lastLoginAt) }}</dd></div>
        </dl>
      </AppCard>
    </div>
    <MyEmploymentCard v-if="auth.organization" class="mt-6" compact />
  </div>
</template>
