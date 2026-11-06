<script setup lang="ts">
import type { BreakdownComponent } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';

/** Monthly and annual split of a CTC: earnings (gross), employer contributions and the total cost. */
defineProps<{ components: BreakdownComponent[]; monthlyGross: number; employerPf: number; employerEsi: number; monthlyCtc: number }>();
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <caption class="sr-only">Salary breakdown</caption>
      <thead>
        <tr class="text-left text-xs text-fg-muted">
          <th scope="col" class="py-2 pr-3 font-medium">Component</th>
          <th scope="col" class="py-2 pr-3 text-right font-medium">Monthly</th>
          <th scope="col" class="py-2 text-right font-medium">Annual</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line/60">
        <tr v-for="c in components" :key="c.componentId">
          <td class="py-2 pr-3 text-fg">
            {{ c.name }}
            <span v-if="!c.taxable" class="ml-1 text-xs text-fg-subtle">(non-taxable)</span>
          </td>
          <td class="py-2 pr-3 text-right tabular-nums">{{ rupees(c.monthly) }}</td>
          <td class="py-2 text-right tabular-nums text-fg-muted">{{ rupees(c.monthly * 12) }}</td>
        </tr>
        <tr class="font-semibold">
          <td class="py-2 pr-3 text-fg">Gross salary</td>
          <td class="py-2 pr-3 text-right tabular-nums">{{ rupees(monthlyGross) }}</td>
          <td class="py-2 text-right tabular-nums">{{ rupees(monthlyGross * 12) }}</td>
        </tr>
        <tr v-if="employerPf">
          <td class="py-2 pr-3 text-fg-muted">Employer PF</td>
          <td class="py-2 pr-3 text-right tabular-nums text-fg-muted">{{ rupees(employerPf) }}</td>
          <td class="py-2 text-right tabular-nums text-fg-muted">{{ rupees(employerPf * 12) }}</td>
        </tr>
        <tr v-if="employerEsi">
          <td class="py-2 pr-3 text-fg-muted">Employer ESI</td>
          <td class="py-2 pr-3 text-right tabular-nums text-fg-muted">{{ rupees(employerEsi) }}</td>
          <td class="py-2 text-right tabular-nums text-fg-muted">{{ rupees(employerEsi * 12) }}</td>
        </tr>
        <tr class="font-semibold">
          <td class="py-2 pr-3 text-fg">Cost to company</td>
          <td class="py-2 pr-3 text-right tabular-nums">{{ rupees(monthlyCtc) }}</td>
          <td class="py-2 text-right tabular-nums">{{ rupees(monthlyCtc * 12) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
