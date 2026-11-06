import { ref, shallowRef, type Ref } from 'vue';

/** Loads data with loading/error state. Call `run()` to (re)load. */
export function useAsync<T>(loader: () => Promise<T>, { immediate = true }: { immediate?: boolean } = {}) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<unknown>(null);
  let sequence = 0;

  async function run(): Promise<void> {
    const current = ++sequence;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader();
      if (current === sequence) data.value = result;
    } catch (e) {
      if (current === sequence) error.value = e;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  if (immediate) void run();
  return { data, loading, error, run };
}

/** Wraps a mutation with a pending flag. Errors propagate to the caller. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const pending = ref(false);
  async function execute(...args: A): Promise<R> {
    pending.value = true;
    try {
      return await fn(...args);
    } finally {
      pending.value = false;
    }
  }
  return { pending, execute };
}
