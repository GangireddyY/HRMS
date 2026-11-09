<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Copy, Fingerprint, Hash, KeyRound, MapPin, Pencil, Plug, Plus, Trash2 } from '@lucide/vue';
import { apiAssetUrl } from '@/core/http/http-client';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Device } from '@/modules/attendance/types';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAddTile, AppAlert, AppBadge, AppButton, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppStatStrip, AppSwitch, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** Biometric / RFID devices pushing punches with their own API key. */
const feedback = useFeedbackStore();
const devices = useAsync(() => attendanceApi.devices());
const locations = useAsync(() => structureApi.locations());
const locationOptions = computed(() => (locations.data.value ?? []).map((l) => ({ value: l.id, label: l.name })));
const endpoint = computed(() => new URL(apiAssetUrl('/attendance/device/punches')!, window.location.origin).toString());
const sample = computed(() => JSON.stringify({ punches: [{ userCode: '1042', timestamp: '2026-11-06T09:02:11+05:30', direction: 'AUTO' }] }, null, 2));

const { fieldErrors, formError, handle, reset } = useFormErrors();
const editing = ref<Device | 'new' | null>(null);
const form = reactive({ name: '', locationId: null as string | null, serialNumber: '', isActive: true });
function edit(d: Device | null) {
  reset();
  editing.value = d ?? 'new';
  Object.assign(form, d ? { name: d.name, locationId: d.locationId, serialNumber: d.serialNumber ?? '', isActive: d.isActive } : { name: '', locationId: null, serialNumber: '', isActive: true });
}
const busy = ref(false);
const shownKey = ref<{ device: string; key: string } | null>(null);
async function save() {
  reset();
  busy.value = true;
  try {
    if (editing.value === 'new') {
      const d = await attendanceApi.createDevice({ name: form.name, locationId: form.locationId, serialNumber: form.serialNumber || null });
      shownKey.value = { device: d.name, key: d.apiKey! };
    } else {
      await attendanceApi.updateDevice((editing.value as Device).id, { name: form.name, locationId: form.locationId, serialNumber: form.serialNumber || null, isActive: form.isActive });
      feedback.success('Device updated');
    }
    editing.value = null;
    await devices.run();
  } catch (e) {
    handle(e, 'Could not save the device');
  } finally {
    busy.value = false;
  }
}
async function rotate(d: Device) {
  if (!(await feedback.confirm({ title: `New key for "${d.name}"?`, message: 'The current key stops working straight away; update the device with the new one.', confirmLabel: 'Issue new key' }))) return;
  try {
    const r = await attendanceApi.rotateDeviceKey(d.id);
    shownKey.value = { device: r.name, key: r.apiKey! };
    await devices.run();
  } catch (e) {
    feedback.error('Could not issue a new key', e);
  }
}
async function remove(d: Device) {
  if (!(await feedback.confirm({ title: `Delete "${d.name}"?`, message: 'Devices that have sent punches can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await attendanceApi.removeDevice(d.id);
    feedback.success('Device deleted');
    await devices.run();
  } catch (e) {
    feedback.error('Could not delete the device', e);
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    feedback.success('Copied');
  } catch {
    feedback.error('Could not copy', new Error('Select the text and copy it instead.'));
  }
}

// ---- Connection status -------------------------------------------------------------------------------------------
type Health = 'online' | 'idle' | 'offline' | 'never' | 'inactive';
/** Online: heard from in the last 15 minutes; idle: today; offline: not for a day or more. */
function health(d: Device): Health {
  if (!d.isActive) return 'inactive';
  if (!d.lastSeenAt) return 'never';
  const minutes = (Date.now() - new Date(d.lastSeenAt).getTime()) / 60_000;
  return minutes <= 15 ? 'online' : minutes <= 1440 ? 'idle' : 'offline';
}
const HEALTH: Record<Health, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; dot: string }> = {
  online: { label: 'Online', tone: 'success', dot: 'bg-success' },
  idle: { label: 'Idle', tone: 'warning', dot: 'bg-warning' },
  offline: { label: 'Offline', tone: 'danger', dot: 'bg-danger' },
  never: { label: 'Not connected yet', tone: 'info', dot: 'bg-info' },
  inactive: { label: 'Inactive', tone: 'neutral', dot: 'bg-fg-subtle' },
};
const list = computed(() => devices.data.value ?? []);
const filter = ref<string | null>(null);
const count = (h: Health[]) => list.value.filter((d) => h.includes(health(d))).length;
const punches = computed(() => list.value.reduce((n, d) => n + (d.punchesLast24h ?? 0), 0));
const strip = computed<StripItem[]>(() => [
  { key: 'all', label: 'All devices', value: list.value.length, tone: 'brand', hint: `${punches.value} punch${punches.value === 1 ? '' : 'es'} in 24 h` },
  { key: 'online', label: 'Online', value: count(['online']), tone: 'success', hint: 'Seen in the last 15 min' },
  { key: 'idle', label: 'Idle', value: count(['idle']), tone: 'warning', hint: 'Seen today' },
  { key: 'offline', label: 'Offline or never seen', value: count(['offline', 'never']), tone: 'danger', hint: 'Check power and network' },
  { key: 'inactive', label: 'Inactive', value: count(['inactive']), tone: 'neutral' },
]);
const shown = computed(() => {
  const f = filter.value;
  if (!f) return list.value;
  return list.value.filter((d) => (f === 'offline' ? ['offline', 'never'].includes(health(d)) : health(d) === f));
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Attendance devices" description="Biometric and card readers send punches to HRMS with their own key. Match people with their user number on the device (or their employee code).">
      <template #actions><AppButton :icon="Plus" @click="edit(null)">Add device</AppButton></template>
    </AppPageHeader>

    <AppStatStrip v-if="list.length" label="Devices by status" :items="strip" selectable :selected="filter ?? 'all'" @select="(k) => (filter = k === 'all' ? null : k)" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <AppErrorState v-if="devices.error.value" :error="devices.error.value" @retry="devices.run" />
        <ul v-else-if="devices.loading.value && !devices.data.value" class="grid gap-4 md:grid-cols-2" aria-label="Loading devices">
          <li v-for="i in 2" :key="i" class="card space-y-3 p-4"><div class="skeleton h-5 w-1/2 rounded-full" /><div class="skeleton h-3 w-2/3 rounded-full" /><div class="skeleton h-16 w-full rounded-md" /></li>
        </ul>
        <div v-else-if="!list.length" class="card">
          <AppEmptyState :icon="Fingerprint" title="No devices yet" description="Add a device to receive its punches. You'll get a key to enter on the device or its bridge program.">
            <AppButton :icon="Plus" @click="edit(null)">Add device</AppButton>
          </AppEmptyState>
        </div>
        <div v-else-if="!shown.length" class="card">
          <AppEmptyState compact :icon="Fingerprint" title="No devices in this state">
            <AppButton size="sm" variant="secondary" @click="filter = null">Show all devices</AppButton>
          </AppEmptyState>
        </div>
        <ul v-else class="grid gap-4 md:grid-cols-2" aria-label="Devices">
          <li v-for="d in shown" :key="d.id" :class="['card flex flex-col p-4', !d.isActive && 'opacity-75']">
            <div class="flex items-start gap-3">
              <span class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true">
                <Fingerprint :size="20" />
                <span :class="['absolute -end-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-surface', HEALTH[health(d)].dot]" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="truncate font-semibold text-fg">{{ d.name }}</h2>
                <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                  <span class="inline-flex items-center gap-1"><MapPin :size="12" aria-hidden="true" />{{ d.location?.name ?? 'No location' }}</span>
                  <span v-if="d.serialNumber" class="inline-flex items-center gap-1"><Hash :size="12" aria-hidden="true" /><span class="sr-only">Serial number</span>{{ d.serialNumber }}</span>
                </p>
              </div>
              <AppBadge :tone="HEALTH[health(d)].tone" size="sm" dot>{{ HEALTH[health(d)].label }}</AppBadge>
            </div>

            <dl class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line/70 text-xs ring-1 ring-line/70">
              <div class="bg-surface px-3 py-2.5">
                <dt class="text-fg-muted">Last seen</dt>
                <dd class="mt-0.5 text-sm font-medium text-fg" :title="d.lastSeenAt ? formatDateTime(d.lastSeenAt) : undefined">{{ d.lastSeenAt ? timeAgo(d.lastSeenAt) : 'Never' }}</dd>
              </div>
              <div class="bg-surface px-3 py-2.5">
                <dt class="text-fg-muted">Punches (24 h)</dt>
                <dd class="mt-0.5 text-sm font-medium text-fg tabular-nums">{{ d.punchesLast24h ?? 0 }}</dd>
              </div>
              <div class="bg-surface px-3 py-2.5">
                <dt class="text-fg-muted">Key</dt>
                <dd class="mt-0.5 truncate font-mono text-xs text-fg" :title="d.keyHint">{{ d.keyHint }}</dd>
              </div>
              <div class="bg-surface px-3 py-2.5">
                <dt class="text-fg-muted">Added</dt>
                <dd class="mt-0.5 text-sm text-fg">{{ formatDate(d.createdAt) }}</dd>
              </div>
            </dl>
            <p v-if="health(d) === 'never'" class="mt-3 text-xs text-fg-muted">Waiting for the first punch. Enter the key on the device and point it at the endpoint on the right.</p>
            <p v-else-if="health(d) === 'offline'" class="mt-3 text-xs text-danger-fg">No contact for over a day. Check the device's power, network and key.</p>

            <div class="mt-auto flex flex-wrap justify-end gap-1 pt-4">
              <AppButton size="sm" variant="ghost" :icon="KeyRound" :aria-label="`New key for ${d.name}`" @click="rotate(d)">New key</AppButton>
              <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${d.name}`" @click="edit(d)">Edit</AppButton>
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${d.name}`" @click="remove(d)">Delete</AppButton>
            </div>
          </li>
          <li><AppAddTile class="h-full" title="Add device" description="Another reader, gate or kiosk." @click="edit(null)" /></li>
        </ul>
      </div>

      <section class="card" aria-labelledby="connect-title">
        <header class="flex items-center gap-3 border-b border-line/70 px-4 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Plug :size="16" /></span>
          <div class="min-w-0">
            <h2 id="connect-title" class="text-sm font-semibold text-fg">Connecting a device</h2>
            <p class="text-xs text-fg-muted">Most devices (or a small bridge program next to them) can send punches over HTTPS.</p>
          </div>
        </header>
        <div class="space-y-4 p-4 text-sm">
          <ol class="space-y-3">
            <li class="flex gap-3">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">1</span>
              <div class="min-w-0 flex-1">
                <p class="text-fg">Send <code class="text-xs">POST</code> requests to</p>
                <div class="mt-1.5 flex items-center gap-1 rounded-md bg-surface-muted py-1 ps-2.5 pe-1 ring-1 ring-line/70">
                  <code class="min-w-0 flex-1 truncate text-xs text-fg" :title="endpoint">{{ endpoint }}</code>
                  <AppButton size="xs" variant="ghost" :icon="Copy" aria-label="Copy endpoint" @click="copy(endpoint)" />
                </div>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">2</span>
              <p class="text-fg">Put the device key in the <code class="text-xs">X-Device-Key</code> header.</p>
            </li>
            <li class="flex gap-3">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">3</span>
              <p class="text-fg">Send up to 500 punches at a time; repeats are ignored, so it is safe to resend.</p>
            </li>
          </ol>
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <p class="text-xs font-medium text-fg-muted">Example request body</p>
              <AppButton size="xs" variant="ghost" :icon="Copy" @click="copy(sample)">Copy</AppButton>
            </div>
            <pre class="overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs text-fg ring-1 ring-line/70 focus-visible:outline-2 focus-visible:outline-brand-500" tabindex="0" aria-label="Example device request">{{ sample }}</pre>
          </div>
        </div>
      </section>
    </div>

    <AppModal :open="!!editing" :title="editing === 'new' ? 'Add device' : 'Edit device'" size="sm" @close="editing = null">
      <form id="device-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Name" required :maxlength="80" placeholder="e.g. Main entrance" :error="fieldErrors.name" />
        <AppSelect v-model="form.locationId" label="Location" :options="locationOptions" placeholder="None" :error="fieldErrors.locationId" />
        <AppInput v-model="form.serialNumber" label="Serial number" :maxlength="60" :error="fieldErrors.serialNumber" />
        <AppSwitch v-if="editing !== 'new'" v-model="form.isActive" label="Active" description="Inactive devices are refused." />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton type="submit" form="device-form" :loading="busy" :disabled="form.name.trim().length < 2">{{ editing === 'new' ? 'Add device' : 'Save' }}</AppButton>
      </template>
    </AppModal>

    <AppModal :open="!!shownKey" :title="`Key for ${shownKey?.device}`" description="Copy it now and enter it on the device. It won't be shown again." :dismissible="false" size="sm" @close="shownKey = null">
      <div class="flex items-center gap-2 rounded-xl bg-surface-muted p-3">
        <code class="min-w-0 flex-1 text-xs break-all text-fg">{{ shownKey?.key }}</code>
        <AppButton size="sm" variant="secondary" :icon="Copy" @click="copy(shownKey!.key)">Copy</AppButton>
      </div>
      <template #footer><AppButton @click="shownKey = null">I've saved it</AppButton></template>
    </AppModal>
  </div>
</template>
