<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AppWindow, Power, Trash2, Users } from '@lucide/vue';
import VectorAccessPeople from '@/modules/integrations/components/VectorAccessPeople.vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import { useVectorStore } from '@/modules/integrations/vector.store';
import { rolesApi } from '@/modules/roles/api/roles.api';
import RolePicker from '@/modules/users/components/RolePicker.vue';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppSkeleton, AppSwitch, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** Vector connector: keys, who may open it, and the people list — each in its own tab. */
const vector = useVectorStore();
const feedback = useFeedbackStore();
const settings = useAsync(() => integrationsApi.vector());
const roles = useAsync(() => rolesApi.list());
const { fieldErrors, formError, handle, reset } = useFormErrors();
const tab = ref<'keys' | 'access' | 'people'>('keys');
const peopleCount = ref<number | null>(null);
const form = reactive({
  apiBaseUrl: '',
  appOrigin: '',
  publishableKey: '',
  secretKey: '',
  enabled: true,
  allowedRoleIds: [] as string[],
});

watch(
  () => settings.data.value,
  (s) => {
    if (!s) return;
    vector.apply(s);
    Object.assign(form, {
      apiBaseUrl: s.apiBaseUrl ?? '',
      appOrigin: s.appOrigin ?? '',
      publishableKey: s.publishableKey ?? '',
      secretKey: '',
      enabled: s.configured ? s.enabled : true,
      allowedRoleIds: [...(s.allowedRoleIds ?? [])],
    });
    if (!s.configured && tab.value !== 'keys') tab.value = 'keys';
  },
  { immediate: true },
);

const configured = computed(() => !!settings.data.value?.configured);
const tabs = computed(() => [
  { key: 'keys', label: 'Connector keys', icon: AppWindow },
  { key: 'access', label: 'Connector enabled', icon: Power, count: configured.value ? (form.enabled ? 1 : 0) : null },
  { key: 'people', label: 'People with access', icon: Users, count: configured.value ? peopleCount.value : null },
]);

const canSave = computed(
  () =>
    form.apiBaseUrl.trim().length >= 8 &&
    form.appOrigin.trim().length >= 8 &&
    form.publishableKey.trim().startsWith('pk_live_') &&
    (form.secretKey.trim().startsWith('sk_live_') || !!settings.data.value?.hasSecretKey),
);

const connectionBadge = computed(() => {
  const s = settings.data.value;
  if (!s?.configured) return { tone: 'neutral' as const, label: 'Not set' };
  if (!s.enabled) return { tone: 'neutral' as const, label: 'Off in HRMS' };
  if (s.remoteStatus === 'live') return { tone: 'success' as const, label: 'Connected' };
  if (s.remoteStatus === 'off') return { tone: 'warning' as const, label: 'Off on Vector' };
  if (s.remoteStatus === 'unreachable') return { tone: 'danger' as const, label: 'Vector unreachable' };
  return { tone: 'neutral' as const, label: 'Keys saved' };
});

const remoteHint = computed(() => {
  const s = settings.data.value;
  if (!s?.configured || !s.enabled) return null;
  if (s.remoteStatus === 'off') {
    return 'Vector has Access off for this partner app, or these keys no longer match. Turn Access on in Vector → Integrations, or paste the current publishable and secret keys and save.';
  }
  if (s.remoteStatus === 'unreachable') {
    return 'HRMS cannot reach Vector at the API base URL. Confirm Vector is running and the URL is correct.';
  }
  return null;
});
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    settings.data.value = await integrationsApi.saveVector({
      apiBaseUrl: form.apiBaseUrl.trim(),
      appOrigin: form.appOrigin.trim() || null,
      publishableKey: form.publishableKey.trim(),
      secretKey: form.secretKey.trim() || null,
      enabled: form.enabled,
      allowedRoleIds: form.allowedRoleIds,
    });
    form.secretKey = '';
    form.allowedRoleIds = [...(settings.data.value.allowedRoleIds ?? [])];
    vector.apply(settings.data.value);
    feedback.success(form.enabled ? 'Vector connected — allowed roles can open it from Apps → Vector' : 'Vector connector saved');
  } catch (e) {
    handle(e, 'Could not save the Vector connector');
  } finally {
    saving.value = false;
  }
}

async function disconnect() {
  if (
    !(await feedback.confirm({
      title: 'Remove Vector connector?',
      message:
        'This permanently disconnects Vector from HRMS.\n\n' +
        'What you will lose\n' +
        '• The API URL, app URL, publishable key and secret key stored here\n' +
        '• Role access you configured for Vector\n' +
        '• The Apps → Vector item in the sidebar\n' +
        '• The ability to open the Vector workspace from HRMS\n\n' +
        'To reconnect later you must add everything again: in Vector go to Organization settings → Integrations → Workspace embed, copy the keys, then paste the API URL, app URL, publishable key and secret key on this page and save.\n\n' +
        'Type REMOVE below only if you are sure.',
      confirmLabel: 'Remove and disconnect',
      requireText: 'REMOVE',
      danger: true,
    }))
  )
    return;
  try {
    await integrationsApi.removeVector();
    await settings.run();
    vector.apply(settings.data.value);
    peopleCount.value = null;
    tab.value = 'keys';
    feedback.success('Vector connector removed');
  } catch (e) {
    feedback.error('Could not remove the connector', e);
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-fg-muted">
        <template v-if="settings.data.value?.vectorOrgName">Linked to {{ settings.data.value.vectorOrgName }}</template>
        <template v-else-if="settings.data.value?.updatedAt">Last saved {{ timeAgo(settings.data.value.updatedAt) }}</template>
        <template v-else>Connect Vector, choose who may open it, then manage people.</template>
      </p>
      <div class="flex items-center gap-2">
        <AppButton v-if="settings.data.value?.configured" size="sm" variant="ghost" @click="settings.run">Refresh status</AppButton>
        <AppBadge v-if="settings.data.value" :tone="connectionBadge.tone" dot>{{ connectionBadge.label }}</AppBadge>
      </div>
    </div>

    <AppSkeleton v-if="settings.loading.value && !settings.data.value" :lines="6" />
    <AppErrorState v-else-if="settings.error.value" :error="settings.error.value" @retry="settings.run" />
    <AppTabs v-else-if="settings.data.value" v-model="tab" :tabs="tabs" :fill="true" class="min-h-0 flex-1">
      <AppCard v-if="tab === 'keys'" :padded="false" class="min-h-0 overflow-y-auto">
        <form class="space-y-5 px-5 py-6" novalidate @submit.prevent="save">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppAlert v-else-if="remoteHint" tone="warning">{{ remoteHint }}</AppAlert>
          <div v-if="!settings.data.value.configured" class="rounded-xl bg-surface-muted/60 p-4 text-sm">
            <p class="font-medium text-fg">In Vector</p>
            <ol class="mt-1 list-decimal space-y-0.5 ps-4 text-xs text-fg-muted">
              <li>Open Organization settings → Integrations → Workspace embed</li>
              <li>Create an embed app (name it e.g. “HRMS”)</li>
              <li>Copy the <span class="font-mono">pk_live_…</span> and <span class="font-mono">sk_live_…</span> keys here</li>
            </ol>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <AppInput v-model="form.apiBaseUrl" label="Vector API base URL" required placeholder="https://vector.example.com/api" help="Ask your Vector admin for the API base URL." :error="fieldErrors.apiBaseUrl" />
            <AppInput
              v-model="form.appOrigin"
              label="Vector app URL"
              required
              placeholder="https://vector.example.com"
              help="The Vector web app origin used to open the embedded workspace."
              :error="fieldErrors.appOrigin"
            />
            <AppInput v-model="form.publishableKey" label="Publishable key" required placeholder="pk_live_…" :maxlength="64" :error="fieldErrors.publishableKey" class="md:col-span-2" />
            <AppInput
              v-model="form.secretKey"
              type="password"
              label="Secret key"
              autocomplete="new-password"
              class="md:col-span-2"
              :placeholder="settings.data.value.hasSecretKey ? `Stored (${settings.data.value.secretPrefix}…) · leave empty to keep` : 'sk_live_… (shown once in Vector)'"
              :error="fieldErrors.secretKey"
            />
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <AppButton v-if="settings.data.value.configured" type="button" variant="ghost" :icon="Trash2" @click="disconnect">Remove</AppButton>
            <AppButton type="submit" :loading="saving" :disabled="!canSave">Save Vector keys</AppButton>
          </div>
        </form>
      </AppCard>

      <AppCard v-else-if="tab === 'access'" :padded="false" class="min-h-0 overflow-y-auto">
        <form v-if="configured" class="space-y-5 px-5 py-6" novalidate @submit.prevent="save">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppSwitch v-model="form.enabled" label="Connector enabled" description="When on, Vector appears under Apps for roles you allow below (and for integration admins)." />

          <div class="space-y-2 rounded-xl border border-line/80 bg-surface-muted/40 p-4">
            <div>
              <h3 class="text-sm font-semibold text-fg">Who can open Vector</h3>
              <p class="text-xs text-fg-muted">
                Selected roles see Apps → Vector and sign in with their own Vector email and password. Integration admins always can. Leave none selected to restrict to admins only.
              </p>
            </div>
            <AppSkeleton v-if="roles.loading.value && !roles.data.value" :lines="3" />
            <AppErrorState v-else-if="roles.error.value" :error="roles.error.value" @retry="roles.run" />
            <RolePicker
              v-else-if="roles.data.value"
              v-model="form.allowedRoleIds"
              :roles="roles.data.value"
              label="Allowed roles"
              :required="false"
              :error="fieldErrors.allowedRoleIds"
            />
            <p v-else class="text-xs text-fg-muted">You need permission to view roles to choose who can open Vector.</p>
          </div>

          <div class="flex justify-end">
            <AppButton type="submit" :loading="saving">Save access settings</AppButton>
          </div>
        </form>
        <div v-else class="px-5 py-10 text-center text-sm text-fg-muted">Save connector keys first, then turn the connector on and choose roles here.</div>
      </AppCard>

      <div v-else-if="tab === 'people'" class="min-h-0 flex-1">
        <VectorAccessPeople
          v-if="configured"
          :configured="settings.data.value.configured && settings.data.value.enabled"
          :allowed-role-ids="settings.data.value.allowedRoleIds ?? []"
          @count="peopleCount = $event"
        />
        <AppCard v-else class="px-5 py-10 text-center text-sm text-fg-muted">Save connector keys and allow roles before managing people.</AppCard>
      </div>
    </AppTabs>
  </div>
</template>
