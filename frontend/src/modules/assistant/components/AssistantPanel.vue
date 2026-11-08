<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, ArrowUp, Eraser, Loader2, Sparkles, X } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { accessibleWorkspaces, visibleSections } from '@/core/navigation/workspaces';
import { useAssistantStore } from '@/modules/assistant/assistant.store';
import { answer, suggestions, type Page } from '@/modules/assistant/engine';
import { AppBadge } from '@/shared/components';

/** Slide-over assistant: ask in plain language, get answers from live data with links to act. Ctrl/⌘+J toggles it. */
const store = useAssistantStore();
const auth = useAuthStore();
const subject = useAccessSubject();
const route = useRoute();
const input = ref('');
const field = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const busy = ref(false);

const pages = computed<Page[]>(() =>
  accessibleWorkspaces(subject.value).flatMap((ws) => visibleSections(ws, subject.value).flatMap((s) => s.items.map((i) => ({ label: i.label, hint: ws.label, to: i.to })))),
);
const ctx = computed(() => ({ auth, pages: pages.value }));
const prompts = computed(() => suggestions(ctx.value));

async function ask(text: string) {
  const question = text.trim();
  if (!question || busy.value) return;
  input.value = '';
  store.add({ role: 'user', text: question });
  const id = store.add({ role: 'assistant', text: '', pending: true });
  busy.value = true;
  await scrollDown();
  try {
    const reply = await answer(question, ctx.value);
    store.update(id, { text: reply.text, reply, pending: false });
  } finally {
    busy.value = false;
    await scrollDown();
    field.value?.focus();
  }
}

async function scrollDown() {
  await nextTick();
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' });
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void ask(input.value);
  }
}

function toggleShortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    store.open = !store.open;
  } else if (e.key === 'Escape' && store.open) {
    store.open = false;
  }
}
const openFromEvent = () => (store.open = true);
onMounted(() => {
  window.addEventListener('keydown', toggleShortcut);
  window.addEventListener('hrms:assistant-open', openFromEvent);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', toggleShortcut);
  window.removeEventListener('hrms:assistant-open', openFromEvent);
});

watch(
  () => store.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    field.value?.focus();
    await scrollDown();
  },
);
watch(
  () => store.queued,
  (q) => {
    if (!q) return;
    store.queued = null;
    void ask(q);
  },
  { immediate: true },
);
// On small screens the panel covers the page, so following a link closes it.
watch(() => route.fullPath, () => {
  if (window.innerWidth < 1024) store.open = false;
});
</script>

<template>
  <Transition enter-from-class="translate-x-full opacity-0" leave-to-class="translate-x-full opacity-0" enter-active-class="transition duration-200 ease-out" leave-active-class="transition duration-150 ease-in">
    <aside
      v-if="store.open"
      class="pt-safe pb-safe fixed inset-y-0 end-0 z-40 flex w-full flex-col border-s border-line bg-surface shadow-pop sm:w-[420px]"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
    >
      <header class="bg-ai-wash flex items-center gap-3 border-b border-line px-4 py-3">
        <span class="ai-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-md"><Sparkles :size="16" aria-hidden="true" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="assistant-title" class="text-gradient text-sm font-semibold">HRMS Assistant</h2>
          <p class="truncate text-xs text-fg-muted">Answers from your live HR data, within your access</p>
        </div>
        <button v-if="store.messages.length" type="button" class="rounded-md p-2 text-fg-subtle transition hover:bg-surface-muted hover:text-fg" aria-label="Clear the conversation" title="Clear" @click="store.clear()">
          <Eraser :size="16" />
        </button>
        <button type="button" class="rounded-md p-2 text-fg-subtle transition hover:bg-surface-muted hover:text-fg" aria-label="Close assistant" @click="store.open = false">
          <X :size="17" />
        </button>
      </header>

      <div ref="scroller" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        <div v-if="!store.messages.length" class="space-y-4">
          <div class="rounded-lg bg-surface-muted/60 p-4">
            <p class="text-sm font-medium text-fg">Hi {{ auth.user?.firstName }}, what can I help with?</p>
            <p class="mt-1 text-sm text-fg-muted">Ask about leave, attendance, approvals, people, payslips, jobs, holidays or policies — or tell me what you want to do.</p>
          </div>
          <div>
            <p class="mb-2 text-xs font-medium text-fg-subtle">Try asking</p>
            <div class="flex flex-wrap gap-2">
              <button v-for="p in prompts" :key="p" type="button" class="rounded-full border border-line bg-surface px-3 py-2 text-sm text-fg transition hover:border-brand-500/50 hover:bg-accent-soft" @click="ask(p)">{{ p }}</button>
            </div>
          </div>
        </div>

        <template v-for="m in store.messages" :key="m.id">
          <div v-if="m.role === 'user'" class="flex justify-end">
            <p class="max-w-[85%] rounded-lg rounded-ee-sm bg-brand-600 px-3 py-2 text-sm text-white">{{ m.text }}</p>
          </div>
          <div v-else class="flex gap-3">
            <span class="ai-chip mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"><Sparkles :size="12" aria-hidden="true" /></span>
            <div class="min-w-0 flex-1 space-y-3">
              <p v-if="m.pending" class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 :size="14" class="animate-spin" aria-hidden="true" /> Looking that up…</p>
              <template v-else>
                <p class="text-sm text-fg">{{ m.text }}</p>
                <dl v-if="m.reply?.stats?.length" class="grid grid-cols-2 gap-2">
                  <div v-for="s in m.reply.stats" :key="s.label" class="rounded-md border border-line px-3 py-2">
                    <dt class="truncate text-2xs text-fg-muted">{{ s.label }}</dt>
                    <dd class="text-base font-semibold text-fg tabular-nums">{{ s.value }}</dd>
                    <dd v-if="s.hint" class="truncate text-2xs text-fg-subtle">{{ s.hint }}</dd>
                  </div>
                </dl>
                <ul v-if="m.reply?.items?.length" class="divide-y divide-line/60 rounded-md border border-line">
                  <li v-for="i in m.reply.items" :key="i.id">
                    <component
                      :is="i.to ? 'RouterLink' : 'button'"
                      :to="i.to"
                      :type="i.to ? undefined : 'button'"
                      class="flex w-full items-center gap-2 px-3 py-2 text-start transition hover:bg-surface-muted/60"
                      @click="!i.to && ask(i.label)"
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-fg">{{ i.label }}</span>
                        <span v-if="i.meta" class="block truncate text-xs text-fg-muted">{{ i.meta }}</span>
                      </span>
                      <AppBadge v-if="i.badge" size="sm">{{ i.badge }}</AppBadge>
                      <ArrowRight v-if="i.to" :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                    </component>
                  </li>
                </ul>
                <div v-if="m.reply?.actions?.length" class="flex flex-wrap gap-2">
                  <RouterLink v-for="a in m.reply.actions" :key="a.to" :to="a.to" class="inline-flex items-center gap-1 rounded-md border border-brand-500/40 px-3 py-1 text-xs font-medium text-accent-fg transition hover:bg-accent-soft">
                    {{ a.label }}<ArrowRight :size="12" aria-hidden="true" />
                  </RouterLink>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <form class="border-t border-line p-3" @submit.prevent="ask(input)">
        <div class="ai-ring flex items-end gap-2 rounded-lg px-3 py-2 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-500)_15%,transparent)]">
          <textarea
            ref="field"
            v-model="input"
            rows="1"
            placeholder="Ask anything about your HR data…"
            aria-label="Ask the assistant"
            class="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            @keydown="onKey"
          />
          <button type="submit" :disabled="!input.trim() || busy" class="ai-chip flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition disabled:opacity-40" aria-label="Send">
            <ArrowUp :size="15" />
          </button>
        </div>
        <p class="mt-2 text-center text-2xs text-fg-subtle">Enter to send · Ctrl J to open or close</p>
      </form>
    </aside>
  </Transition>
</template>
