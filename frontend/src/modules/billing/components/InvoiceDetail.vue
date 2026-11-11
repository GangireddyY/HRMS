<script setup lang="ts">
import type { InvoiceRow } from '@/modules/billing/types';
import { METHOD_LABELS, money, periodLabel } from '@/modules/billing/utils/billing';
import { formatDate } from '@/shared/utils/format';

/** An invoice's lines, totals and the payments recorded against it. */
defineProps<{ invoice: InvoiceRow }>();
</script>

<template>
  <div class="space-y-5">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
      <div>
        <dt class="text-xs text-fg-muted">Period</dt>
        <dd class="font-medium text-fg">{{ periodLabel(invoice.periodStart, invoice.periodEnd) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-fg-muted">Issued</dt>
        <dd class="font-medium text-fg">{{ formatDate(invoice.issueDate) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-fg-muted">Due</dt>
        <dd :class="['font-medium', invoice.overdue ? 'text-danger-fg' : 'text-fg']">{{ formatDate(invoice.dueDate) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-fg-muted">Billed to</dt>
        <dd class="truncate font-medium text-fg" :title="invoice.billTo?.email ?? undefined">{{ invoice.billTo?.name ?? '—' }}</dd>
      </div>
    </dl>

    <div class="overflow-x-auto rounded-xl ring-1 ring-line">
      <table class="w-full text-sm">
        <thead class="bg-surface-muted text-xs text-fg-muted">
          <tr>
            <th class="px-3 py-2 text-start font-medium">Description</th>
            <th class="px-3 py-2 text-end font-medium">Qty</th>
            <th class="px-3 py-2 text-end font-medium">Rate</th>
            <th class="px-3 py-2 text-end font-medium">Amount</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="(l, i) in invoice.lines" :key="i">
            <td class="px-3 py-2 text-fg">{{ l.description }}</td>
            <td class="px-3 py-2 text-end text-fg-muted tabular-nums">{{ l.quantity }}</td>
            <td class="px-3 py-2 text-end text-fg-muted tabular-nums">{{ money(l.unitPrice, invoice.currency) }}</td>
            <td class="px-3 py-2 text-end text-fg tabular-nums">{{ money(l.amount, invoice.currency) }}</td>
          </tr>
        </tbody>
        <tfoot class="text-sm tabular-nums">
          <tr class="border-t border-line">
            <td colspan="3" class="px-3 pt-2.5 text-end text-fg-muted">Subtotal</td>
            <td class="px-3 pt-2.5 text-end text-fg">{{ money(invoice.subtotal, invoice.currency) }}</td>
          </tr>
          <tr v-if="invoice.discount">
            <td colspan="3" class="px-3 pt-1 text-end text-fg-muted">Discount</td>
            <td class="px-3 pt-1 text-end text-fg">−{{ money(invoice.discount, invoice.currency) }}</td>
          </tr>
          <tr>
            <td colspan="3" class="px-3 pt-1 text-end text-fg-muted">Tax (GST {{ invoice.taxRatePct }}%)</td>
            <td class="px-3 pt-1 text-end text-fg">{{ money(invoice.tax, invoice.currency) }}</td>
          </tr>
          <tr class="font-semibold">
            <td colspan="3" class="px-3 pt-1.5 pb-1 text-end text-fg">Total</td>
            <td class="px-3 pt-1.5 pb-1 text-end text-fg">{{ money(invoice.total, invoice.currency) }}</td>
          </tr>
          <tr v-if="invoice.status !== 'VOID'" class="font-semibold">
            <td colspan="3" class="px-3 pb-2.5 text-end text-fg-muted">Balance due</td>
            <td :class="['px-3 pb-2.5 text-end', invoice.balance ? 'text-fg' : 'text-success-fg']">{{ money(invoice.balance, invoice.currency) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p v-if="invoice.notes" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm whitespace-pre-line text-fg-muted">{{ invoice.notes }}</p>
    <p v-if="invoice.status === 'VOID'" class="text-sm text-fg-muted">Voided {{ formatDate(invoice.voidedAt) }}{{ invoice.voidReason ? `: ${invoice.voidReason}` : '' }}</p>

    <div v-if="invoice.payments.length">
      <p class="mb-2 text-sm font-semibold text-fg">Payments</p>
      <ul class="divide-y divide-line rounded-xl ring-1 ring-line">
        <li v-for="p in invoice.payments" :key="p.id" class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span class="text-fg">
            {{ formatDate(p.paidOn) }} · {{ METHOD_LABELS[p.method] }}<span v-if="p.reference" class="font-mono text-xs text-fg-muted"> · {{ p.reference }}</span>
          </span>
          <span class="font-medium text-success-fg tabular-nums">{{ money(p.amount, invoice.currency) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
