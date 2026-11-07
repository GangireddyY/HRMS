<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { ANNOUNCEMENT_CATEGORIES, type AnnouncementCategory } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { Announcement } from '@/modules/engagement/types';
import { CATEGORY_LABELS } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Draft or edit an announcement / event, with its audience. */
const props = defineProps<{ open: boolean; announcement: Announcement | null }>();
const emit = defineEmits<{ close: []; saved: [a: Announcement] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const locations = useAsync(() => structureApi.locations(), { immediate: false });
const pad = (n: number) => String(n).padStart(2, '0');
const split = (iso: string | null) => {
  if (!iso) return { date: undefined as string | undefined, time: '10:00' };
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};
const form = reactive({
  title: '',
  body: '',
  category: 'GENERAL' as AnnouncementCategory,
  pinned: false,
  requiresAck: false,
  departmentIds: [] as string[],
  locationIds: [] as string[],
  eventDate: undefined as string | undefined,
  eventStart: '10:00',
  eventEnd: '',
  eventLocation: '',
  expiresOn: undefined as string | undefined,
});
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (!departments.data.value) void departments.run();
    if (!locations.data.value) void locations.run();
    const a = props.announcement;
    const start = split(a?.eventStartsAt ?? null);
    Object.assign(form, {
      title: a?.title ?? '',
      body: a?.body ?? '',
      category: a?.category ?? 'GENERAL',
      pinned: a?.pinned ?? false,
      requiresAck: a?.requiresAck ?? false,
      departmentIds: [...(a?.departmentIds ?? [])],
      locationIds: [...(a?.locationIds ?? [])],
      eventDate: start.date,
      eventStart: start.time,
      eventEnd: a?.eventEndsAt ? split(a.eventEndsAt).time : '',
      eventLocation: a?.eventLocation ?? '',
      expiresOn: a?.expiresAt ? split(a.expiresAt).date : undefined,
    });
  },
  { immediate: true },
);
const pickDepartment = ref<string | null>(null);
const pickLocation = ref<string | null>(null);
watch(pickDepartment, (id) => {
  if (id && !form.departmentIds.includes(id)) form.departmentIds.push(id);
  pickDepartment.value = null;
});
watch(pickLocation, (id) => {
  if (id && !form.locationIds.includes(id)) form.locationIds.push(id);
  pickLocation.value = null;
});
const options = (rows: { id: string; name: string; isActive?: boolean }[] | null | undefined, taken: string[]) => (rows ?? []).filter((r) => r.isActive !== false && !taken.includes(r.id)).map((r) => ({ value: r.id, label: r.name }));
const nameOf = (rows: { id: string; name: string }[] | null | undefined, id: string) => rows?.find((r) => r.id === id)?.name ?? '…';
const categoryOptions = ANNOUNCEMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const isEvent = computed(() => form.category === 'EVENT');
const canSave = computed(() => form.title.trim().length >= 3 && form.body.trim().length >= 3 && (!isEvent.value || !!form.eventDate));

const at = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, hh, mm).toISOString();
};
async function save() {
  reset();
  saving.value = true;
  const body = {
    title: form.title,
    body: form.body,
    category: form.category,
    pinned: form.pinned,
    requiresAck: form.requiresAck,
    departmentIds: form.departmentIds.length ? form.departmentIds : null,
    locationIds: form.locationIds.length ? form.locationIds : null,
    eventStartsAt: isEvent.value && form.eventDate ? at(form.eventDate, form.eventStart) : null,
    eventEndsAt: isEvent.value && form.eventDate && form.eventEnd ? at(form.eventDate, form.eventEnd) : null,
    eventLocation: isEvent.value ? form.eventLocation || null : null,
    expiresAt: form.expiresOn ? at(form.expiresOn, '23:59') : null,
  };
  try {
    emit('saved', props.announcement ? await engagementApi.updateAnnouncement(props.announcement.id, body) : await engagementApi.createAnnouncement(body));
  } catch (e) {
    handle(e, 'Could not save the announcement');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="announcement ? 'Edit announcement' : 'New announcement'" description="Saved as a draft; publish it when ready." size="lg" @close="emit('close')">
    <form id="announcement-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_180px]">
        <AppInput v-model="form.title" label="Title" required :maxlength="200" :error="fieldErrors.title" />
        <AppSelect v-model="form.category" label="Type" :options="categoryOptions" :clearable="false" />
      </div>
      <AppTextarea v-model="form.body" label="Message" required :rows="6" :maxlength="20000" :error="fieldErrors.body" />
      <div v-if="isEvent" class="grid gap-4 rounded-xl p-4 ring-1 ring-line sm:grid-cols-4">
        <AppDatePicker v-model="form.eventDate" label="Event date" required :error="fieldErrors.eventStartsAt" />
        <AppInput v-model="form.eventStart" label="Starts" type="time" />
        <AppInput v-model="form.eventEnd" label="Ends" type="time" :error="fieldErrors.eventEndsAt" />
        <AppInput v-model="form.eventLocation" label="Where" :maxlength="300" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <AppSelect v-model="pickDepartment" label="Departments" placeholder="Everyone" :options="options(departments.data.value, form.departmentIds)" />
          <ul v-if="form.departmentIds.length" class="mt-2 flex flex-wrap gap-2">
            <li v-for="id in form.departmentIds" :key="id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 pe-2 ps-3 text-sm text-fg">
              {{ nameOf(departments.data.value, id) }}
              <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${nameOf(departments.data.value, id)}`" @click="form.departmentIds = form.departmentIds.filter((x) => x !== id)"><X :size="13" /></button>
            </li>
          </ul>
        </div>
        <div>
          <AppSelect v-model="pickLocation" label="Locations" placeholder="Everywhere" :options="options(locations.data.value, form.locationIds)" />
          <ul v-if="form.locationIds.length" class="mt-2 flex flex-wrap gap-2">
            <li v-for="id in form.locationIds" :key="id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 pe-2 ps-3 text-sm text-fg">
              {{ nameOf(locations.data.value, id) }}
              <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${nameOf(locations.data.value, id)}`" @click="form.locationIds = form.locationIds.filter((x) => x !== id)"><X :size="13" /></button>
            </li>
          </ul>
        </div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-3">
          <AppCheckbox v-model="form.pinned" label="Pin to the top of the feed" />
          <AppCheckbox v-model="form.requiresAck" label="Ask everyone to acknowledge" description="Track who has read it (e.g. policy changes)." />
        </div>
        <AppDatePicker v-model="form.expiresOn" label="Show until" help="Leave empty to keep it in the feed." />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="announcement-form" :loading="saving" :disabled="!canSave">Save draft</AppButton>
    </template>
  </AppModal>
</template>
