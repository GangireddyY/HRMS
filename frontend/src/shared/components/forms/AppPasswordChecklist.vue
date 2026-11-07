<script setup lang="ts">
import { computed } from 'vue';
import { Check } from '@lucide/vue';
import { PASSWORD_MIN_LENGTH_FLOOR, type PasswordPolicy } from '@contracts';

/** `compact`: on short laptop screens the rules sit three to a row with tighter spacing. */
const props = defineProps<{ password: string; policy: PasswordPolicy; compact?: boolean }>();

const rules = computed(() => {
  const p = props.password;
  const min = Math.max(props.policy.minLength, PASSWORD_MIN_LENGTH_FLOOR);
  const list = [{ label: `At least ${min} characters`, ok: p.length >= min }];
  if (props.policy.requireUppercase) list.push({ label: 'An uppercase letter', ok: /[A-Z]/.test(p) });
  if (props.policy.requireLowercase) list.push({ label: 'A lowercase letter', ok: /[a-z]/.test(p) });
  if (props.policy.requireNumber) list.push({ label: 'A number', ok: /[0-9]/.test(p) });
  if (props.policy.requireSymbol) list.push({ label: 'A symbol', ok: /[^A-Za-z0-9]/.test(p) });
  return list;
});
const met = computed(() => rules.value.filter((r) => r.ok).length);
const strength = computed(() => (props.password ? met.value / rules.value.length : 0));
const barColor = computed(() => (strength.value === 1 ? 'bg-emerald-500' : strength.value >= 0.6 ? 'bg-amber-500' : 'bg-red-500'));
</script>

<template>
  <div :class="['space-y-3', compact && 'lg:short:space-y-2']">
    <div class="flex gap-1" aria-hidden="true">
      <span
        v-for="(r, i) in rules"
        :key="r.label"
        :class="['h-1 flex-1 rounded-full transition-colors duration-300', password && i < met ? barColor : 'bg-surface-muted']"
      />
    </div>
    <ul :class="['grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2', compact && 'lg:short:grid-cols-3 lg:short:gap-x-3 lg:short:gap-y-1']" aria-label="Password requirements">
      <li v-for="r in rules" :key="r.label" :class="['flex items-center gap-2 transition-colors', r.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-fg-muted']">
        <span
          :class="[
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition',
            r.ok ? 'bg-emerald-500 text-white' : 'border border-line-strong',
          ]"
          aria-hidden="true"
        >
          <Check v-if="r.ok" :size="10" :stroke-width="3.5" />
        </span>
        <span>{{ r.label }}<span class="sr-only">{{ r.ok ? ' (met)' : ' (not met)' }}</span></span>
      </li>
      <li v-if="policy.historyCount > 0" :class="['text-fg-subtle sm:col-span-2', compact && 'lg:short:col-span-3']">Cannot reuse your last {{ policy.historyCount }} passwords or contain your name/email.</li>
    </ul>
  </div>
</template>
