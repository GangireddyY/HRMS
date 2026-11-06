import { computed } from 'vue';
import type { AccessSubject } from '@/core/navigation/access-rules';
import { useAuthStore } from '@/core/auth/auth.store';

/** Adapts the auth store to the access-rule evaluator used by routes and menus. */
export function useAccessSubject() {
  const auth = useAuthStore();
  return computed<AccessSubject>(() => {
    void auth.context; // track context changes
    return {
      can: auth.can,
      hasFeature: auth.hasFeature,
      canPlatform: auth.canPlatform,
      hasOrganization: !!auth.organization,
    };
  });
}
