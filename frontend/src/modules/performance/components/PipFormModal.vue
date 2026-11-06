<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { PipDetail } from '@/modules/performance/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Open an improvement plan for someone in your scope: reason, measurable objectives and a time frame. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [p: PipDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const today = new Date().toISOString().slice(0, 10);
const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const form = reactive({ employeeId: null as string | null, reason: '', startDate: today as string | undefined, endDate: in60 as string | undefined, objectives: [{ title: '', measure: '' }] });
const saving = ref(false);
const people = ref<{ value: string; label: string; description?: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const page = await employeesApi.list({ status: 'ACTIVE', search: q || undefined, pageSize: 20, sort: 'name:asc' });
      people.value = page.items.map((e) => ({ value: e.id, label: e.fullName, description: [e.employeeCode, e.designation?.name].filter(Boolean).join(' · ') }));
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
    search('');
    Object.assign(form, { employeeId: null, reason: '', startDate: today, endDate: in60, objectives: [{ title: '', measure: '' }] });
  },
  { immediate: true },
);
const canSave = computed(() => !!form.employeeId && form.reason.trim().length >= 10 && !!form.startDate && !!form.endDate && form.objectives.every((o) => o.title.trim().length >= 3));

async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await performanceApi.createPip({ employeeId: form.employeeId!, reason: form.reason, startDate: form.startDate!, endDate: form.endDate!, objectives: form.objectives.map((o) => ({ title: o.title, measure: o.measure || null })) }));
  } catch (e) {
    handle(e, 'Could not open the plan');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="New improvement plan" description="The employee is notified and asked to acknowledge the plan. Record check-ins as it runs." size="lg" @close="emit('close')">
    <form id="pip-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-model="form.employeeId" label="Employee" required :options="people" placeholder="Search by name…" searchable remote :error="fieldErrors.employeeId" @search="search" />
      <AppTextarea v-model="form.reason" label="Why a plan is needed" required :rows="3" :maxlength="2000" placeholder="The specific performance gaps, with examples" :error="fieldErrors.reason" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.startDate" label="Starts" required :error="fieldErrors.startDate" />
        <AppDatePicker v-model="form.endDate" label="Ends" required :min="form.startDate" :error="fieldErrors.endDate" />
      </div>
      <div>
        <p class="label">Objectives</p>
        <ul class="space-y-2">
          <li v-for="(o, i) in form.objectives" :key="i" class="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <AppInput v-model="o.title" :aria-label="`Objective ${i + 1}`" placeholder="Objective" :maxlength="200" />
            <AppInput v-model="o.measure" :aria-label="`Objective ${i + 1} measure`" placeholder="How it will be measured" :maxlength="500" />
            <AppButton variant="ghost" :icon="Trash2" :disabled="form.objectives.length === 1" :aria-label="`Remove objective ${i + 1}`" @click="form.objectives.splice(i, 1)" />
          </li>
        </ul>
        <AppButton class="mt-2" size="sm" variant="secondary" :icon="Plus" :disabled="form.objectives.length >= 10" @click="form.objectives.push({ title: '', measure: '' })">Add objective</AppButton>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="pip-form" :loading="saving" :disabled="!canSave">Open plan</AppButton>
    </template>
  </AppModal>
</template>
