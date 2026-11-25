import { ref, type Ref } from 'vue';
import { employeesApi } from '@/modules/people/api/people.api';

export interface PersonOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Active employees for a remote select. The current choice stays labelled after a later search,
 * so a large organization is not limited to the first page of people.
 */
export function usePersonSearch(excludeId?: Ref<string | null | undefined>) {
  const options = ref<PersonOption[]>([]);
  const pinned = ref<PersonOption | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function pin(option: PersonOption | null) {
    pinned.value = option;
  }

  /** Call after the user picks someone who was in the current results. */
  function remember(id: string | null | undefined) {
    if (!id) {
      pinned.value = null;
      return;
    }
    const hit = options.value.find((o) => o.value === id);
    if (hit) pinned.value = hit;
  }

  function search(q: string) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const page = await employeesApi.list({ status: 'ACTIVE', search: q || undefined, pageSize: 20, sort: 'name:asc' });
        const skip = excludeId?.value;
        const found = page.items
          .filter((e) => e.id !== skip)
          .map((e) => ({ value: e.id, label: e.fullName, description: [e.employeeCode, e.designation?.name].filter(Boolean).join(' · ') }));
        const keep = pinned.value && pinned.value.value !== skip && !found.some((o) => o.value === pinned.value!.value) ? [pinned.value] : [];
        options.value = [...keep, ...found];
      } catch {
        options.value = pinned.value ? [pinned.value] : [];
      }
    }, 250);
  }

  return { options, search, pin, remember };
}
