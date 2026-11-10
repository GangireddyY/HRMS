<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { HELPDESK_CATEGORIES, HELPDESK_CATEGORY_LABELS, HELPDESK_PRIORITIES, HELPDESK_SLA_HOURS, type HelpdeskCategory, type HelpdeskPriority } from '@contracts';
import { helpdeskApi } from '@/modules/services/api/services.api';
import type { TicketDetail } from '@/modules/services/types';
import { HELPDESK_PRIORITY_LABELS } from '@/modules/services/utils/services-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Raise a ticket with HR. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [ticket: TicketDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ category: 'PAYROLL' as HelpdeskCategory, subject: '', description: '', priority: 'NORMAL' as HelpdeskPriority });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { category: 'PAYROLL', subject: '', description: '', priority: 'NORMAL' });
  },
);
const categoryOptions = HELPDESK_CATEGORIES.map((c) => ({ value: c, label: HELPDESK_CATEGORY_LABELS[c] }));
const target = (h: number) => (h >= 48 ? `${h / 24} days` : `${h} hours`);
const priorityOptions = HELPDESK_PRIORITIES.map((p) => ({ value: p, label: HELPDESK_PRIORITY_LABELS[p], description: `Answer within ${target(HELPDESK_SLA_HOURS[p])}` }));
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await helpdeskApi.create({ ...form }));
  } catch (e) {
    handle(e, 'Could not raise the ticket');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Ask HR" description="Questions about pay, leave, documents, policies or anything else. You'll get a reply here and by notification." @close="emit('close')">
    <form id="ticket-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.category" label="Topic" :options="categoryOptions" :clearable="false" />
        <AppSelect v-model="form.priority" label="How urgent?" :options="priorityOptions" :clearable="false" />
      </div>
      <AppInput v-model="form.subject" label="Subject" placeholder="e.g. HRA missing from my October payslip" required :error="fieldErrors.subject" />
      <AppTextarea v-model="form.description" label="Details" required :rows="6" :maxlength="5000" help="Include dates, amounts or document names that help HR answer quickly." :error="fieldErrors.description" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="ticket-form" :loading="saving" :disabled="form.subject.trim().length < 5 || form.description.trim().length < 5">Send to HR</AppButton>
    </template>
  </AppModal>
</template>
