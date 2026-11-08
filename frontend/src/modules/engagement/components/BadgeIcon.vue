<script setup lang="ts">
import { computed } from 'vue';
import { HandHeart, Lightbulb, Medal, Star, Target, Users } from '@lucide/vue';
import type { RecognitionBadge } from '@contracts';

const props = defineProps<{ badge: RecognitionBadge; size?: number }>();
const icon = computed(() => ({ TEAMWORK: Users, INNOVATION: Lightbulb, CUSTOMER_FIRST: Star, OWNERSHIP: Target, EXCELLENCE: Medal, HELPING_HAND: HandHeart })[props.badge]);
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center rounded-xl bg-warning/12 text-warning-fg ring-1 ring-warning/25" :style="{ width: `${(size ?? 18) + 18}px`, height: `${(size ?? 18) + 18}px` }" aria-hidden="true">
    <component :is="icon" :size="size ?? 18" />
  </span>
</template>
