<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Copy, KeySquare } from '@lucide/vue';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { rolesApi } from '@/modules/roles/api/roles.api';
import { AppAlert, AppBadge, AppButton, AppErrorState, AppInput, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** Single sign-on with the organization's OpenID Connect provider (Microsoft Entra ID, Google, Okta, Keycloak…). */
const feedback = useFeedbackStore();
const settings = useAsync(() => organizationApi.sso());
const roles = useAsync(async () => (await rolesApi.list()).map((r) => ({ value: r.key, label: r.name })));
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ enabled: false, issuer: '', clientId: '', clientSecret: '', publicClient: false, domains: '', required: false, autoProvision: false, defaultRoleKey: 'employee', buttonLabel: '' });
watch(
  () => settings.data.value,
  (s) => {
    if (!s) return;
    Object.assign(form, { enabled: s.enabled, issuer: s.issuer ?? '', clientId: s.clientId ?? '', clientSecret: '', publicClient: false, domains: s.emailDomains.join(', '), required: s.required, autoProvision: s.autoProvision, defaultRoleKey: s.defaultRoleKey, buttonLabel: s.buttonLabel ?? '' });
  },
  { immediate: true },
);
const domains = computed(() => form.domains.split(/[\s,;]+/).map((d) => d.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
const canSave = computed(() => form.issuer.trim().length >= 8 && form.clientId.trim().length > 0 && (!form.enabled || domains.value.length > 0));
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    settings.data.value = await organizationApi.updateSso({
      enabled: form.enabled,
      issuer: form.issuer.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret || null,
      publicClient: form.publicClient,
      emailDomains: domains.value,
      required: form.required,
      autoProvision: form.autoProvision,
      defaultRoleKey: form.defaultRoleKey,
      buttonLabel: form.buttonLabel || null,
    });
    feedback.success(form.enabled ? 'Single sign-on saved' : 'Single sign-on turned off', form.enabled ? 'People from your domains can now choose "Sign in with SSO".' : undefined);
  } catch (e) {
    handle(e, 'Could not save single sign-on');
  } finally {
    saving.value = false;
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    feedback.success('Copied');
  } catch {
    feedback.error('Could not copy');
  }
}
</script>

<template>
  <section class="card" aria-labelledby="sso-title">
    <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info-fg ring-1 ring-info/15 ring-inset" aria-hidden="true"><KeySquare :size="17" /></span>
      <div class="min-w-0 flex-1 basis-52">
        <h2 id="sso-title" class="text-sm font-semibold text-fg">Single sign-on</h2>
        <p class="text-xs text-fg-muted">Let people sign in with your company identity provider over OpenID Connect.</p>
      </div>
      <AppBadge v-if="settings.data.value" :tone="settings.data.value.enabled ? 'success' : 'neutral'" dot>{{ settings.data.value.enabled ? (settings.data.value.required ? 'On · required' : 'On') : 'Off' }}</AppBadge>
    </header>
    <AppSkeleton v-if="settings.loading.value && !settings.data.value" class="p-5" :lines="6" />
    <AppErrorState v-else-if="settings.error.value" :error="settings.error.value" @retry="settings.run" />
    <form v-else-if="settings.data.value" class="space-y-5 px-5 py-6" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="rounded-xl bg-surface-muted/60 p-4 text-sm">
        <p class="font-medium text-fg">Register this app with your identity provider</p>
        <p class="mt-0.5 text-xs text-fg-muted">Create a web application (OpenID Connect, authorization code) and add this redirect URI:</p>
        <div class="mt-2 flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-md bg-surface px-2.5 py-1.5 font-mono text-xs text-fg ring-1 ring-line">{{ settings.data.value.redirectUri }}</code>
          <AppButton size="sm" variant="secondary" :icon="Copy" aria-label="Copy the redirect URI" @click="copy(settings.data.value?.redirectUri ?? '')" />
        </div>
        <p class="mt-2 text-xs text-fg-muted">Scopes: <span class="font-mono">openid email profile</span>.</p>
      </div>

      <AppSwitch v-model="form.enabled" label="Turn on single sign-on" description="Saving checks that your provider can be reached." />
      <div class="grid gap-4 md:grid-cols-2">
        <AppInput v-model="form.issuer" label="Issuer URL" required placeholder="https://login.microsoftonline.com/<tenant>/v2.0" :error="fieldErrors.issuer" class="md:col-span-2" />
        <AppInput v-model="form.clientId" label="Client ID" required :maxlength="300" :error="fieldErrors.clientId" />
        <AppInput
          v-model="form.clientSecret"
          type="password"
          label="Client secret"
          autocomplete="new-password"
          :placeholder="settings.data.value?.hasClientSecret ? 'Stored · leave empty to keep' : 'From your provider'"
          :disabled="form.publicClient"
          :error="fieldErrors.clientSecret"
        />
        <AppInput v-model="form.domains" label="Email domains" required placeholder="acme.com, acme.in" help="People with these work emails see your SSO button. Separate with commas." :error="fieldErrors.emailDomains" class="md:col-span-2" />
        <AppInput v-model="form.buttonLabel" label="Button label (optional)" :maxlength="60" placeholder="Continue with Acme SSO" />
      </div>
      <div class="space-y-3 rounded-xl px-4 py-4 ring-1 ring-line ring-inset">
        <AppSwitch v-model="form.required" :disabled="!form.enabled" label="Require single sign-on" description="Members can't use a password. Organization admins keep theirs, so you can't get locked out." />
        <AppSwitch v-model="form.autoProvision" label="Add new people automatically" description="Someone from your domains who isn't a member yet joins with the role below on first sign-in (within your plan's seats)." />
        <AppSelect v-if="form.autoProvision" v-model="form.defaultRoleKey" label="Role for new people" :options="roles.data.value ?? []" :clearable="false" :error="fieldErrors.defaultRoleKey" />
        <AppSwitch v-model="form.publicClient" label="My provider issues no client secret" description="Public client using PKCE only." />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-fg-subtle"><template v-if="settings.data.value?.updatedAt">Last changed {{ timeAgo(settings.data.value.updatedAt) }}</template></p>
        <AppButton type="submit" :loading="saving" :disabled="!canSave">Save single sign-on</AppButton>
      </div>
    </form>
  </section>
</template>
