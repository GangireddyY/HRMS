<script setup lang="ts">
import { computed } from 'vue';
import { apiAssetUrl } from '@/core/http/http-client';
import type { ExitLetter } from '@/modules/exit/types';
import { longDate } from '@/modules/exit/utils/exit-format';

/** A letter on the organization's letterhead, laid out as an A4 page (printable / "Save as PDF"). Always white paper. */
const props = defineProps<{ letter: ExitLetter }>();
const paragraphs = computed(() =>
  props.letter.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean),
);
const logo = computed(() => apiAssetUrl(props.letter.letterhead.logoUrl));
const contact = computed(() => [props.letter.letterhead.phone, props.letter.letterhead.email, props.letter.letterhead.website].filter(Boolean).join(' · '));
</script>

<template>
  <article
    class="relative mx-auto min-h-[60rem] max-w-[52rem] overflow-hidden rounded-2xl bg-white px-8 py-10 text-[15px] leading-relaxed text-zinc-900 shadow-sm ring-1 ring-zinc-200 sm:px-14 print:min-h-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0"
    :aria-label="`${letter.subject} ${letter.reference}`"
  >
    <p
      v-if="letter.revokedAt"
      class="pointer-events-none absolute inset-0 flex -rotate-12 items-center justify-center text-7xl font-bold tracking-widest text-red-500/15 select-none"
      aria-hidden="true"
    >
      REVOKED
    </p>
    <header class="flex flex-wrap items-start justify-between gap-6 border-b-2 border-zinc-800 pb-5">
      <div class="flex min-w-0 items-center gap-4">
        <img v-if="logo" :src="logo" alt="" class="max-h-16 max-w-44 object-contain" />
        <p class="text-xl font-semibold tracking-tight">{{ letter.letterhead.name }}</p>
      </div>
      <div class="text-right text-xs leading-5 text-zinc-600">
        <p v-for="line in letter.letterhead.address" :key="line">{{ line }}</p>
        <p v-if="contact">{{ contact }}</p>
      </div>
    </header>

    <div class="mt-8 flex flex-wrap justify-between gap-2 text-sm">
      <p><span class="text-zinc-500">Ref:</span> {{ letter.reference }}</p>
      <p><span class="text-zinc-500">Date:</span> {{ longDate(letter.letterDate) }}</p>
    </div>
    <p class="mt-8 font-semibold underline underline-offset-4">{{ letter.subject }}</p>
    <div class="mt-6 space-y-4">
      <p v-for="(p, i) in paragraphs" :key="i" class="whitespace-pre-line">{{ p }}</p>
    </div>

    <div class="mt-14">
      <p>For {{ letter.letterhead.name }}</p>
      <div class="h-16" />
      <p class="font-semibold">{{ letter.signatoryName }}</p>
      <p v-if="letter.signatoryTitle" class="text-zinc-600">{{ letter.signatoryTitle }}</p>
    </div>

    <footer v-if="letter.letterhead.registrationNumber" class="mt-16 border-t border-zinc-200 pt-3 text-center text-xs text-zinc-500">
      Registration no. {{ letter.letterhead.registrationNumber }}
    </footer>
  </article>
</template>
