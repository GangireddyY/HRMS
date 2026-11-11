<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CalendarSync, Copy } from '@lucide/vue';
import { http } from '@/core/http/http-client';
import { AppButton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** A private subscription URL for Google Calendar, Outlook or Apple Calendar (shown once; a new one replaces it). */
const feedback = useFeedbackStore();
const active = ref<boolean | null>(null);
const url = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    active.value = (await http.get<{ active: boolean }>('/calendar/feed')).active;
  } catch {
    active.value = null;
  }
});

async function create() {
  if (active.value && !(await feedback.confirm({ title: 'Replace your calendar link?', message: 'Calendars subscribed to the old link stop updating until you add the new one.', confirmLabel: 'Replace' }))) return;
  busy.value = true;
  try {
    const r = await http.post<{ active: boolean; url: string }>('/calendar/feed');
    url.value = r.url;
    active.value = true;
  } catch (e) {
    feedback.error('Could not create a calendar link', e);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  busy.value = true;
  try {
    await http.post('/calendar/feed/remove');
    active.value = false;
    url.value = null;
    feedback.success('Calendar link switched off');
  } catch (e) {
    feedback.error('Could not switch off the calendar link', e);
  } finally {
    busy.value = false;
  }
}
async function copy() {
  if (!url.value) return;
  await navigator.clipboard.writeText(url.value).catch(() => undefined);
  feedback.success('Link copied', 'In Google Calendar: Other calendars → From URL. In Outlook: Add calendar → Subscribe from web.');
}
</script>

<template>
  <div v-if="active !== null" class="space-y-2 rounded-xl border border-line bg-surface-muted/50 p-3">
    <div class="flex flex-wrap items-center gap-3">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-subtle" aria-hidden="true"><CalendarSync class="h-4.5 w-4.5" /></span>
      <div class="min-w-0 flex-1 basis-52">
        <p class="text-sm font-medium text-fg">Calendar subscription</p>
        <p class="text-xs text-fg-muted">Your leave, your team's leave, 1:1s, interviews and holidays in Google Calendar, Outlook or Apple Calendar, kept up to date.</p>
      </div>
      <AppButton size="sm" :variant="active ? 'secondary' : 'primary'" :loading="busy" @click="create">{{ active ? 'New link' : 'Get link' }}</AppButton>
      <AppButton v-if="active" size="sm" variant="ghost" :disabled="busy" @click="remove">Switch off</AppButton>
    </div>
    <div v-if="url" class="flex items-center gap-2 rounded-lg bg-surface p-2 ring-1 ring-line">
      <code class="min-w-0 flex-1 truncate text-xs text-fg" :title="url">{{ url }}</code>
      <AppButton size="xs" variant="secondary" :icon="Copy" @click="copy">Copy</AppButton>
    </div>
    <p v-if="url" class="text-xs text-warning-fg">Keep this link private: anyone with it can see these events. It's shown only now.</p>
  </div>
</template>
