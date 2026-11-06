import { ref } from 'vue';
import { ApiError } from '@/core/http/http-client';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/**
 * Maps API validation errors onto form fields; non-field errors are shown as a form-level message.
 * Returns true when the error was handled as validation/form feedback.
 */
export function useFormErrors() {
  const fieldErrors = ref<Record<string, string>>({});
  const formError = ref<string | null>(null);
  const feedback = useFeedbackStore();

  function reset() {
    fieldErrors.value = {};
    formError.value = null;
  }

  function handle(e: unknown, fallbackTitle = 'Request failed'): void {
    reset();
    if (e instanceof ApiError) {
      if (e.details.length) {
        fieldErrors.value = e.fieldErrors();
        const unmapped = e.details.filter((d) => !d.field);
        formError.value = unmapped.length ? unmapped.map((d) => d.message).join(' ') : e.message;
        return;
      }
      formError.value = e.message;
      return;
    }
    feedback.error(fallbackTitle, e);
  }

  return { fieldErrors, formError, reset, handle };
}
