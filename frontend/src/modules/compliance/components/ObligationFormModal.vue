<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { COMPLIANCE_CATEGORIES, type ComplianceCategory } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import type { Obligation } from '@/modules/compliance/types';
import { OBLIGATION_CATEGORY_LABELS, localIso, scheduleLabel } from '@/modules/compliance/utils/compliance-format';
import { usersApi } from '@/modules/users/api/users.api';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** A statutory obligation: what, to whom, and its yearly due dates (monthly on a day, or specific dates). */
const props = defineProps<{ open: boolean; obligation: Obligation | null }>();
const emit = defineEmits<{ close: []; saved: [o: Obligation] }>();

const auth = useAuthStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const members = useAsync(() => usersApi.list({ page: 1, pageSize: 100, status: 'ACTIVE' }), { immediate: false });
const form = reactive({
  title: '',
  category: 'OTHER' as ComplianceCategory,
  authority: '',
  description: '',
  mode: 'MONTHLY' as 'MONTHLY' | 'DATES',
  day: 15 as string | number,
  dates: '',
  startsOn: undefined as string | undefined,
  endsOn: undefined as string | undefined,
  ownerUserId: null as string | null,
  active: true,
});
const saving = ref(false);
const isMonthly = (d: string[]) => d.length === 12 && new Set(d.map((x) => x.slice(3))).size === 1;
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (auth.can('user.view', 'ORGANIZATION') && !members.data.value) void members.run();
    const o = props.obligation;
    const monthly = o ? isMonthly(o.dueDates) : true;
    Object.assign(form, {
      title: o?.title ?? '',
      category: o?.category ?? 'OTHER',
      authority: o?.authority ?? '',
      description: o?.description ?? '',
      mode: monthly ? 'MONTHLY' : 'DATES',
      day: o && monthly ? Number(o.dueDates[0]!.slice(3)) : 15,
      dates: o && !monthly ? o.dueDates.join(', ') : '',
      startsOn: o?.startsOn ?? localIso(new Date()),
      endsOn: o?.endsOn ?? undefined,
      ownerUserId: o?.owner?.id ?? null,
      active: o?.active ?? true,
    });
  },
  { immediate: true },
);
const categoryOptions = COMPLIANCE_CATEGORIES.map((c) => ({ value: c, label: OBLIGATION_CATEGORY_LABELS[c] }));
const modeOptions = [
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'DATES', label: 'On specific dates each year' },
];
const ownerOptions = computed(() => (members.data.value?.items ?? []).map((m) => ({ value: m.userId, label: `${m.firstName} ${m.lastName}`.trim(), description: m.email })));
const dueDates = computed(() =>
  form.mode === 'MONTHLY'
    ? Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}-${String(Math.min(31, Math.max(1, Number(form.day) || 1))).padStart(2, '0')}`)
    : form.dates
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean),
);
const preview = computed(() => (dueDates.value.every((d) => /^\d{2}-\d{2}$/.test(d)) && dueDates.value.length ? scheduleLabel(dueDates.value) : null));
const canSave = computed(() => form.title.trim().length >= 3 && !!form.startsOn && dueDates.value.length > 0);

async function save() {
  reset();
  saving.value = true;
  const body = {
    title: form.title,
    category: form.category,
    authority: form.authority || null,
    description: form.description || null,
    dueDates: dueDates.value,
    startsOn: form.startsOn!,
    endsOn: form.endsOn ?? null,
    ownerUserId: form.ownerUserId,
    active: form.active,
  };
  try {
    emit('saved', props.obligation ? await complianceApi.updateObligation(props.obligation.id, body) : await complianceApi.createObligation(body));
  } catch (e) {
    handle(e, 'Could not save the obligation');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="obligation ? `Edit ${obligation.title}` : 'New obligation'" size="lg" @close="emit('close')">
    <form id="obligation-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_220px]">
        <AppInput v-model="form.title" label="Title" required :maxlength="200" placeholder="e.g. Shops & establishment licence renewal" :error="fieldErrors.title" />
        <AppSelect v-model="form.category" label="Category" :options="categoryOptions" :clearable="false" />
      </div>
      <AppInput v-model="form.authority" label="Authority" :maxlength="150" placeholder="e.g. EPFO, ESIC, Labour department" />
      <AppTextarea v-model="form.description" label="What to do" :rows="2" :maxlength="2000" />
      <div class="grid gap-4 sm:grid-cols-[220px_1fr]">
        <AppSelect v-model="form.mode" label="Due" :options="modeOptions" :clearable="false" />
        <AppInput v-if="form.mode === 'MONTHLY'" v-model="form.day" label="Day of the month" type="number" :min="1" :max="31" help="31 means the last day of each month." />
        <AppInput v-else v-model="form.dates" label="Dates (MM-DD)" placeholder="01-31, 05-31, 07-31, 10-31" :error="fieldErrors.dueDates" />
      </div>
      <p v-if="preview" class="text-xs text-fg-muted">Due {{ preview }}.</p>
      <p v-if="form.mode === 'MONTHLY' && fieldErrors.dueDates" class="error-text" role="alert">{{ fieldErrors.dueDates }}</p>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.startsOn" label="Tracked from" required :error="fieldErrors.startsOn" />
        <AppDatePicker v-model="form.endsOn" label="Until" help="Leave empty while it applies." :error="fieldErrors.endsOn" />
      </div>
      <AppSelect v-if="auth.can('user.view', 'ORGANIZATION')" v-model="form.ownerUserId" label="Owner" placeholder="No owner" :options="ownerOptions" searchable :error="fieldErrors.ownerUserId" />
      <AppCheckbox v-if="obligation" v-model="form.active" label="Active" description="Inactive obligations are hidden from the calendar; their filings are kept." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="obligation-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
