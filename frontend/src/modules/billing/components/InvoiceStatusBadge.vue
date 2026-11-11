<script setup lang="ts">
import { computed } from 'vue';
import type { InvoiceRow } from '@/modules/billing/types';
import { invoiceState } from '@/modules/billing/utils/billing';
import { AppBadge } from '@/shared/components';

const props = defineProps<{ invoice: Pick<InvoiceRow, 'status' | 'overdue' | 'amountPaid'> }>();
const state = computed(() => invoiceState(props.invoice));
</script>

<template>
  <AppBadge :tone="state.tone" dot>{{ state.label }}</AppBadge>
</template>
