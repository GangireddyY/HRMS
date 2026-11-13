<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { Ban, Hash, KeyRound, MessagesSquare, Pencil, Plus, Power, RefreshCw, RotateCcw, Send, Trash2, Webhook } from '@lucide/vue';
import type { WebhookFormat } from '@contracts';
import ApiKeyModal from '@/modules/integrations/components/ApiKeyModal.vue';
import SecretRevealModal from '@/modules/integrations/components/SecretRevealModal.vue';
import WebhookModal from '@/modules/integrations/components/WebhookModal.vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { ApiKeyRow, WebhookDelivery, WebhookDetail, WebhookRow } from '@/modules/integrations/types';
import { AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Developer integrations: read-only API keys and webhooks with their delivery log. */
const feedback = useFeedbackStore();
const tab = ref<'keys' | 'webhooks'>('keys');
const keys = useAsync(() => integrationsApi.apiKeys());
const grantable = useAsync(() => integrationsApi.grantable());
const hooks = useAsync(() => integrationsApi.webhooks());
const catalog = useAsync(() => integrationsApi.events());
const tabs = computed(() => [
  { key: 'keys', label: 'API keys', icon: KeyRound, count: keys.data.value?.filter((k) => k.status === 'ACTIVE').length ?? null },
  { key: 'webhooks', label: 'Webhooks & alerts', icon: Webhook, count: hooks.data.value?.length ?? null },
]);
const origin = window.location.origin;

// ---- API keys ----------------------------------------------------------------------------------------------
const keyModal = ref(false);
const reveal = ref<{ title: string; secret: string; hint?: string } | null>(null);
function keyCreated(k: ApiKeyRow & { key: string }) {
  keyModal.value = false;
  reveal.value = { title: `API key "${k.name}"`, secret: k.key, hint: `Send it as a bearer token, for example:\ncurl -H "Authorization: Bearer ${k.key.slice(0, 13)}…" ${origin}/api/v1/employees` };
  void keys.run();
}
async function revoke(k: ApiKeyRow) {
  if (!(await feedback.confirm({ title: `Revoke "${k.name}"?`, message: 'Anything using this key stops working immediately.', confirmLabel: 'Revoke', danger: true }))) return;
  try {
    await integrationsApi.revokeApiKey(k.id);
    feedback.success('Key revoked');
    await keys.run();
  } catch (e) {
    feedback.error('Could not revoke the key', e);
  }
}
const keyColumns: TableColumn<ApiKeyRow>[] = [
  { key: 'name', label: 'Key' },
  { key: 'permissions', label: 'Can read' },
  { key: 'used', label: 'Last used' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right', noExport: true },
];
const STATUS_TONE = { ACTIVE: 'success', EXPIRED: 'warning', REVOKED: 'neutral' } as const;

// ---- Webhooks ----------------------------------------------------------------------------------------------
const hookModal = ref<{ open: boolean; webhook: WebhookRow | null }>({ open: false, webhook: null });
function hookSaved(w: WebhookRow & { secret?: string }) {
  hookModal.value = { open: false, webhook: null };
  if (w.secret) reveal.value = { title: 'Webhook signing secret', secret: w.secret, hint: 'Each request carries X-HRMS-Signature: t=<time>,v1=<HMAC-SHA256 of "<t>.<body>" with this secret>. Compare it to reject forged calls.' };
  else feedback.success('Webhook saved');
  void hooks.run();
  if (detail.value?.id === w.id) void openDetail(w.id);
}
const detail = ref<WebhookDetail | null>(null);
const detailLoading = ref(false);
async function openDetail(id: string) {
  detailLoading.value = true;
  try {
    detail.value = await integrationsApi.webhook(id);
  } catch (e) {
    feedback.error('Could not load the webhook', e);
  } finally {
    detailLoading.value = false;
  }
}
const busy = ref<string | null>(null);
async function run<T>(key: string, fn: () => Promise<T>, done?: (r: T) => void) {
  busy.value = key;
  try {
    const r = await fn();
    done?.(r);
    await hooks.run();
    if (detail.value) await openDetail(detail.value.id);
  } catch (e) {
    feedback.error('Something went wrong', e);
  } finally {
    busy.value = null;
  }
}
const ping = (w: WebhookRow) => run('ping', () => integrationsApi.testWebhook(w.id), (d) => (d.status === 'SUCCESS' ? feedback.success('Ping delivered', `HTTP ${d.responseStatus}`) : feedback.error('Ping failed', d.error ?? `HTTP ${d.responseStatus}`)));
const rotate = async (w: WebhookRow) => {
  if (!(await feedback.confirm({ title: 'Rotate the signing secret?', message: 'Deliveries are signed with the new secret straight away; update your receiver.', confirmLabel: 'Rotate' }))) return;
  await run('rotate', () => integrationsApi.rotateSecret(w.id), (r) => (reveal.value = { title: 'New signing secret', secret: r.secret }));
};
const toggle = (w: WebhookRow) => run('toggle', () => integrationsApi.updateWebhook(w.id, { enabled: !w.enabled }), () => feedback.success(w.enabled ? 'Webhook switched off' : 'Webhook switched on'));
const redeliver = (w: WebhookRow, d: WebhookDelivery) => run(`re-${d.id}`, () => integrationsApi.redeliver(w.id, d.id), () => feedback.success('Queued for redelivery'));
async function remove(w: WebhookRow) {
  if (!(await feedback.confirm({ title: 'Delete this webhook?', message: `Deliveries to ${w.url} stop and its log is deleted.`, confirmLabel: 'Delete', danger: true }))) return;
  await run('delete', () => integrationsApi.removeWebhook(w.id), () => {
    detail.value = null;
    feedback.success('Webhook deleted');
  });
}
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const FORMAT_LABEL: Record<WebhookFormat, string> = { JSON: 'Webhook', SLACK: 'Slack', TEAMS: 'Teams' };
const FORMAT_ICON: Record<WebhookFormat, Component> = { JSON: Webhook, SLACK: Hash, TEAMS: MessagesSquare };
const statusTone = (s: number | null) => (s === null ? 'neutral' : s >= 200 && s < 300 ? 'success' : 'danger');
const expanded = ref<string | null>(null);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Integrations" description="Connect other systems: read-only API keys for pulling data, webhooks that push events as they happen, and alerts to Slack or Microsoft Teams channels.">
      <template #actions>
        <AppButton v-if="tab === 'keys'" :icon="Plus" @click="keyModal = true">New API key</AppButton>
        <AppButton v-else :icon="Plus" @click="hookModal = { open: true, webhook: null }">Add webhook or alert</AppButton>
      </template>
    </AppPageHeader>

    <AppTabs v-model="tab" :tabs="tabs">
      <!-- API keys -->
      <AppCard v-if="tab === 'keys'" :padded="false">
        <AppDataTable :columns="keyColumns" :rows="keys.data.value ?? []" :loading="keys.loading.value" :error="keys.error.value" caption="API keys" empty-title="No API keys yet" empty-description="Create a key for a reporting tool or script that needs to read HR data." :grid="false" @retry="keys.run">
          <template #cell-name="{ row }">
            <p class="font-medium text-fg">{{ row.name }}</p>
            <p class="font-mono text-2xs text-fg-muted">{{ row.prefix }}… · by {{ row.createdBy ?? '—' }} · {{ timeAgo(row.createdAt) }}</p>
          </template>
          <template #cell-permissions="{ row }">
            <div class="flex max-w-md flex-wrap gap-1">
              <AppBadge v-for="p in row.permissions.slice(0, 4)" :key="p" size="sm" tone="neutral"><span class="font-mono">{{ p }}</span></AppBadge>
              <AppBadge v-if="row.permissions.length > 4" size="sm" tone="neutral">+{{ row.permissions.length - 4 }}</AppBadge>
            </div>
          </template>
          <template #cell-used="{ row }">
            <p class="text-sm text-fg">{{ row.lastUsedAt ? timeAgo(row.lastUsedAt) : 'Never' }}</p>
            <p v-if="row.lastUsedIp" class="font-mono text-2xs text-fg-muted">{{ row.lastUsedIp }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="STATUS_TONE[row.status as keyof typeof STATUS_TONE]" dot>{{ row.status === 'ACTIVE' ? 'Active' : row.status === 'EXPIRED' ? 'Expired' : 'Revoked' }}</AppBadge>
            <p v-if="row.expiresAt && row.status === 'ACTIVE'" class="text-2xs text-fg-muted">until {{ formatDateTime(row.expiresAt) }}</p>
          </template>
          <template #cell-actions="{ row }">
            <AppButton v-if="row.status === 'ACTIVE'" size="sm" variant="ghost" :icon="Ban" @click="revoke(row)">Revoke</AppButton>
          </template>
        </AppDataTable>
      </AppCard>

      <!-- Webhooks -->
      <template v-else>
        <AppSkeleton v-if="hooks.loading.value && !hooks.data.value" :lines="4" />
        <AppErrorState v-else-if="hooks.error.value" :error="hooks.error.value" @retry="hooks.run" />
        <div v-else-if="!hooks.data.value?.length" class="card">
          <AppEmptyState :icon="Webhook" title="No webhooks or alerts yet" description="Send events such as new joiners, approved leave or paid settlements to another system, or post them to a Slack or Teams channel.">
            <AppButton size="sm" :icon="Plus" @click="hookModal = { open: true, webhook: null }">Add webhook or alert</AppButton>
          </AppEmptyState>
        </div>
        <ul v-else class="grid gap-3 lg:grid-cols-2">
          <li v-for="w in hooks.data.value" :key="w.id" class="card flex flex-col p-4">
            <div class="flex items-start gap-3">
              <span :class="['mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', w.enabled ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-subtle']" aria-hidden="true"><component :is="FORMAT_ICON[w.format]" :size="17" /></span>
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2">
                  <span class="truncate font-mono text-sm font-medium text-fg" :title="w.url">{{ host(w.url) }}</span>
                  <AppBadge v-if="w.format !== 'JSON'" size="sm" tone="neutral">{{ FORMAT_LABEL[w.format] }}</AppBadge>
                </p>
                <p class="truncate text-xs text-fg-muted">{{ w.description ?? w.url }}</p>
              </div>
              <AppBadge :tone="w.enabled ? 'success' : 'neutral'" dot>{{ w.enabled ? 'On' : 'Off' }}</AppBadge>
            </div>
            <div class="mt-3 flex flex-wrap gap-1">
              <AppBadge v-for="e in w.events" :key="e" size="sm" tone="info"><span class="font-mono">{{ e }}</span></AppBadge>
            </div>
            <p v-if="w.disabledReason" class="mt-2 text-xs text-danger-fg">{{ w.disabledReason }}</p>
            <p class="mt-3 text-xs text-fg-muted">
              <template v-if="w.lastDeliveryAt">Last delivery {{ timeAgo(w.lastDeliveryAt) }} · <AppBadge size="sm" :tone="statusTone(w.lastStatus)">{{ w.lastStatus ?? 'no response' }}</AppBadge></template>
              <template v-else>No deliveries yet</template>
              <template v-if="w.consecutiveFailures"> · <span class="text-danger-fg">{{ w.consecutiveFailures }} failed in a row</span></template>
            </p>
            <div class="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
              <AppButton size="sm" variant="secondary" @click="openDetail(w.id)">Deliveries</AppButton>
              <AppButton size="sm" variant="ghost" :icon="Send" :loading="busy === 'ping'" @click="ping(w)">Send test</AppButton>
              <AppButton size="sm" variant="ghost" :icon="Pencil" @click="hookModal = { open: true, webhook: w }">Edit</AppButton>
            </div>
          </li>
        </ul>
      </template>
    </AppTabs>

    <ApiKeyModal :open="keyModal" :grantable="grantable.data.value ?? []" @close="keyModal = false" @created="keyCreated" />
    <WebhookModal :open="hookModal.open" :webhook="hookModal.webhook" :groups="catalog.data.value?.groups ?? []" @close="hookModal = { open: false, webhook: null }" @saved="hookSaved" />
    <SecretRevealModal :open="!!reveal" :title="reveal?.title ?? ''" :secret="reveal?.secret ?? null" :hint="reveal?.hint" @close="reveal = null" />

    <AppModal :open="!!detail" :title="detail ? host(detail.url) : 'Webhook'" :description="detail?.url" size="lg" @close="detail = null">
      <div v-if="detail" class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <AppButton size="sm" variant="secondary" :icon="Send" :loading="busy === 'ping'" @click="ping(detail)">Send test</AppButton>
          <AppButton v-if="detail.format === 'JSON'" size="sm" variant="secondary" :icon="RotateCcw" :loading="busy === 'rotate'" @click="rotate(detail)">Rotate secret</AppButton>
          <AppButton size="sm" variant="secondary" :icon="Power" :loading="busy === 'toggle'" @click="toggle(detail)">{{ detail.enabled ? 'Switch off' : 'Switch on' }}</AppButton>
          <AppButton size="sm" variant="ghost" :icon="Trash2" :loading="busy === 'delete'" class="ms-auto" @click="remove(detail)">Delete</AppButton>
        </div>
        <AppEmptyState v-if="!detail.deliveries.length" compact :icon="Send" title="No deliveries yet" description="Events this webhook subscribes to appear here as they're sent." />
        <ul v-else class="divide-y divide-line/70 rounded-lg ring-1 ring-line">
          <li v-for="d in detail.deliveries" :key="d.id" class="px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <AppBadge size="sm" :tone="d.status === 'SUCCESS' ? 'success' : d.status === 'FAILED' ? 'danger' : 'warning'" dot>{{ d.status === 'SUCCESS' ? 'Delivered' : d.status === 'FAILED' ? 'Failed' : 'Retrying' }}</AppBadge>
              <span class="font-mono text-sm text-fg">{{ d.event }}</span>
              <AppBadge v-if="d.responseStatus" size="sm" :tone="statusTone(d.responseStatus)">HTTP {{ d.responseStatus }}</AppBadge>
              <span class="text-xs text-fg-muted">{{ formatDateTime(d.createdAt) }} · {{ d.attempts }} attempt{{ d.attempts === 1 ? '' : 's' }}</span>
              <span class="ms-auto flex gap-1">
                <AppButton size="sm" variant="ghost" @click="expanded = expanded === d.id ? null : d.id">{{ expanded === d.id ? 'Hide' : 'Payload' }}</AppButton>
                <AppButton v-if="d.status !== 'PENDING' && d.event !== 'ping'" size="sm" variant="ghost" :icon="RefreshCw" :loading="busy === `re-${d.id}`" @click="redeliver(detail, d)">Redeliver</AppButton>
              </span>
            </div>
            <p v-if="d.error" class="mt-1 text-xs text-danger-fg">{{ d.error }}</p>
            <pre v-if="expanded === d.id" class="mt-2 max-h-64 overflow-auto rounded-md bg-surface-muted p-3 font-mono text-2xs text-fg">{{ JSON.stringify(d.payload, null, 2) }}</pre>
          </li>
        </ul>
      </div>
      <AppSkeleton v-else-if="detailLoading" :lines="5" />
    </AppModal>
  </div>
</template>
