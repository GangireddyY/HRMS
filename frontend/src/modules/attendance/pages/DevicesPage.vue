<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Copy, Fingerprint, KeyRound, Pencil, Plus, Trash2 } from '@lucide/vue';
import { apiAssetUrl } from '@/core/http/http-client';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Device } from '@/modules/attendance/types';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSelect, AppSwitch, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Biometric / RFID devices pushing punches with their own API key. */
const feedback = useFeedbackStore();
const devices = useAsync(() => attendanceApi.devices());
const locations = useAsync(() => structureApi.locations());
const locationOptions = computed(() => (locations.data.value ?? []).map((l) => ({ value: l.id, label: l.name })));
const endpoint = computed(() => new URL(apiAssetUrl('/attendance/device/punches')!, window.location.origin).toString());
const sample = computed(() => JSON.stringify({ punches: [{ userCode: '1042', timestamp: '2026-11-06T09:02:11+05:30', direction: 'AUTO' }] }, null, 2));

const columns: TableColumn<Device>[] = [
  { key: 'name', label: 'Device' },
  { key: 'key', label: 'Key' },
  { key: 'seen', label: 'Last seen' },
  { key: 'punches', label: 'Punches (24 h)', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];

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
</script>

<template>
  <div>
    <AppPageHeader title="Attendance devices" description="Biometric and card readers send punches to HRMS with their own key. Match people with their user number on the device (or their employee code).">
      <template #actions><AppButton :icon="Plus" @click="edit(null)">Add device</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="devices.data.value ?? []" :loading="devices.loading.value" :error="devices.error.value" caption="Attendance devices" empty-title="No devices yet" empty-description="Add a device to receive its punches." @retry="devices.run">
        <template #cell-name="{ row }">
          <p class="flex items-center gap-2 font-medium text-fg"><Fingerprint :size="14" class="text-fg-subtle" aria-hidden="true" />{{ row.name }} <AppBadge v-if="!row.isActive" size="sm">Inactive</AppBadge></p>
          <p class="text-xs text-fg-muted">{{ [row.location?.name, row.serialNumber].filter(Boolean).join(' · ') || '—' }}</p>
        </template>
        <template #cell-key="{ row }"><code class="text-xs text-fg-muted">{{ row.keyHint }}</code></template>
        <template #cell-seen="{ row }"><span :title="row.lastSeenAt ? formatDateTime(row.lastSeenAt) : undefined" class="text-fg-muted">{{ row.lastSeenAt ? timeAgo(row.lastSeenAt) : 'Never' }}</span></template>
        <template #cell-punches="{ row }"><span class="tabular-nums">{{ row.punchesLast24h ?? 0 }}</span></template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="KeyRound" :aria-label="`New key for ${row.name}`" @click="rotate(row)" />
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="edit(row)" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <AppCard class="mt-4" title="Connecting a device" description="Most devices (or a small bridge program next to them) can send punches over HTTPS.">
      <ol class="list-decimal space-y-2 ps-5 text-sm text-fg">
        <li>Send <code class="text-xs">POST</code> requests to <code class="text-xs break-all">{{ endpoint }}</code></li>
        <li>Put the device key in the <code class="text-xs">X-Device-Key</code> header.</li>
        <li>Send up to 500 punches at a time; repeats are ignored, so it is safe to resend.</li>
      </ol>
      <pre class="mt-3 overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs text-fg">{{ sample }}</pre>
    </AppCard>

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
