import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/**
 * Guards a routed form page: leaving it (a link, Back, a workspace switch) while `dirty` asks "Discard changes?",
 * and closing or reloading the tab triggers the browser's own warning. Query-only changes on the same page (tabs,
 * filters) don't count as leaving. Call `allowLeave()` right before navigating away after a successful save.
 * Pop-up forms (AppModal) protect themselves; this is for whole pages.
 */
export function useUnsavedGuard(dirty: MaybeRefOrGetter<boolean>, opts: { title?: string; message?: string } = {}) {
  const feedback = useFeedbackStore();
  const route = useRoute();
  let bypass = false;

  const confirmLeave = async (): Promise<boolean> => {
    if (bypass || !toValue(dirty)) return true;
    return feedback.confirm({
      title: opts.title ?? 'Discard changes?',
      message: opts.message ?? 'You have unsaved changes on this page. If you leave now, they will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
  };

  onBeforeRouteLeave(async (to) => (to.path === route.path ? true : confirmLeave()));

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (bypass || !toValue(dirty)) return;
    e.preventDefault();
    e.returnValue = '';
  };
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

  return {
    /** Ask before an in-page action that would drop the edits (e.g. switching the record shown). */
    confirmLeave,
    /** The changes were saved: the next navigation leaves without asking. */
    allowLeave: () => {
      bypass = true;
    },
  };
}
