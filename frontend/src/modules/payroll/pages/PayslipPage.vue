<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Printer } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PayslipView from '@/modules/payroll/components/PayslipView.vue';
import { AppButton, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';

/** One payslip, printable (browser "Save as PDF"). Used in My Workspace and from payroll runs. */
const route = useRoute();
const id = computed(() => String(route.params.id));
const payslip = useAsync(() => payrollApi.payslip(id.value));
watch(id, () => void payslip.run());
const print = () => window.print();
const back = computed(() => (route.path.startsWith('/hr') && payslip.data.value ? `/hr/payroll/runs/${payslip.data.value.runId}` : '/me/payslips'));
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <AppPageHeader class="print:hidden" :title="payslip.data.value ? `Payslip · ${payslip.data.value.period}` : 'Payslip'" :back="back" :back-label="route.path.startsWith('/hr') ? 'Payroll run' : 'Payslips'">
      <template #actions><AppButton variant="secondary" :icon="Printer" :disabled="!payslip.data.value" @click="print">Print / save as PDF</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="payslip.loading.value && !payslip.data.value" :lines="10" />
    <AppErrorState v-else-if="payslip.error.value" :error="payslip.error.value" title="This payslip isn't available" @retry="payslip.run" />
    <PayslipView v-else-if="payslip.data.value" :payslip="payslip.data.value" />
  </div>
</template>
