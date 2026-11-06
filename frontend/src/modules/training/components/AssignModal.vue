<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import { trainingApi } from '@/modules/training/api/training.api';
import type { CourseDetail } from '@/modules/training/types';
import { isSessionBasedDelivery, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppButton, AppDatePicker, AppModal, AppSelect } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Assign a course to people and/or whole departments within your scope, with an optional due date and session. */
const props = defineProps<{ open: boolean; course: CourseDetail }>();
const emit = defineEmits<{ close: []; done: [result: { assigned: number; skipped: { name: string; reason: string }[] }] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const form = reactive({ employeeIds: [] as string[], departmentIds: [] as string[], dueDate: undefined as string | undefined, sessionId: null as string | null });
const names = ref(new Map<string, string>());
const people = ref<{ value: string; label: string; description?: string }[]>([]);
const pickPerson = ref<string | null>(null);
const pickDepartment = ref<string | null>(null);
const saving = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const page = await employeesApi.list({ status: 'ACTIVE', search: q || undefined, pageSize: 20, sort: 'name:asc' });
      people.value = page.items.map((e) => ({ value: e.id, label: e.fullName, description: [e.employeeCode, e.designation?.name].filter(Boolean).join(' · ') }));
      for (const e of page.items) names.value.set(e.id, e.fullName);
    } catch {
      people.value = [];
    }
  }, 250);
}
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (!departments.data.value) void departments.run();
    search('');
    Object.assign(form, { employeeIds: [], departmentIds: [], dueDate: undefined, sessionId: null });
  },
  { immediate: true },
);
watch(pickPerson, (id) => {
  if (id && !form.employeeIds.includes(id)) form.employeeIds.push(id);
  pickPerson.value = null;
});
watch(pickDepartment, (id) => {
  if (id && !form.departmentIds.includes(id)) form.departmentIds.push(id);
  pickDepartment.value = null;
});
const departmentName = (id: string) => departments.data.value?.find((d) => d.id === id)?.name ?? '…';
const departmentOptions = computed(() => (departments.data.value ?? []).filter((d) => d.isActive !== false && !form.departmentIds.includes(d.id)).map((d) => ({ value: d.id, label: d.name })));
const personOptions = computed(() => people.value.filter((p) => !form.employeeIds.includes(p.value)));
const sessionOptions = computed(() =>
  props.course.sessions.filter((s) => s.status === 'SCHEDULED' && new Date(s.startsAt) > new Date()).map((s) => ({ value: s.id, label: sessionWhen(s), description: s.capacity === null ? 'No seat limit' : `${s.seatsLeft} of ${s.capacity} seats left` })),
);
const today = new Date().toISOString().slice(0, 10);

async function save() {
  reset();
  saving.value = true;
  try {
    const r = await trainingApi.assign({ courseId: props.course.id, employeeIds: form.employeeIds, departmentIds: form.departmentIds, dueDate: form.dueDate ?? null, sessionId: form.sessionId });
    emit('done', r);
  } catch (e) {
    handle(e, 'Could not assign the course');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="`Assign ${course.title}`" description="People already enrolled, or certified and not yet expired, are skipped. Everyone assigned is notified." size="lg" @close="emit('close')">
    <div class="space-y-4">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div>
        <AppSelect v-model="pickPerson" label="People" :options="personOptions" placeholder="Search by name…" searchable remote :error="fieldErrors.employeeIds" @search="search" />
        <ul v-if="form.employeeIds.length" class="mt-2 flex flex-wrap gap-2">
          <li v-for="id in form.employeeIds" :key="id" class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pr-1.5 pl-3 text-sm text-fg">
            {{ names.get(id) ?? '…' }}
            <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${names.get(id)}`" @click="form.employeeIds = form.employeeIds.filter((x) => x !== id)"><X :size="13" /></button>
          </li>
        </ul>
      </div>
      <div>
        <AppSelect v-model="pickDepartment" label="Whole departments" :options="departmentOptions" placeholder="Add a department…" />
        <ul v-if="form.departmentIds.length" class="mt-2 flex flex-wrap gap-2">
          <li v-for="id in form.departmentIds" :key="id" class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pr-1.5 pl-3 text-sm text-fg">
            {{ departmentName(id) }}
            <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${departmentName(id)}`" @click="form.departmentIds = form.departmentIds.filter((x) => x !== id)"><X :size="13" /></button>
          </li>
        </ul>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.dueDate" label="Complete by" :min="today" />
        <AppSelect v-if="isSessionBasedDelivery(course.delivery)" v-model="form.sessionId" label="Session" :options="sessionOptions" placeholder="Let them choose" />
      </div>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!form.employeeIds.length && !form.departmentIds.length" @click="save">Assign</AppButton>
    </template>
  </AppModal>
</template>
