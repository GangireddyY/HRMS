import { createRouter, createWebHistory } from 'vue-router';
import { isAllowed, type AccessRule, type AccessSubject } from '@/core/navigation/access-rules';
import { homePath } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { routes } from './routes';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    /** Accessible without authentication. */
    public?: boolean;
    /** Redirect authenticated users away (login, register…). */
    guestOnly?: boolean;
    access?: AccessRule;
    /** On large screens the page fills the content area and scrolls its own panes (the shell does not scroll). */
    fill?: boolean;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

function subjectFrom(auth: ReturnType<typeof useAuthStore>): AccessSubject {
  return { can: auth.can, hasFeature: auth.hasFeature, canPlatform: auth.canPlatform, hasOrganization: !!auth.organization };
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();

  if (to.meta.public) {
    if (to.meta.guestOnly && auth.isAuthenticated) return homePath(subjectFrom(auth));
    return true;
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }
  if (to.name === 'home') return homePath(subjectFrom(auth));
  if (auth.isRestricted && to.name !== 'me-security') return { name: 'me-security' };

  const subject = subjectFrom(auth);
  // Every matched record (layout and page) must allow access.
  if (!to.matched.every((r) => isAllowed(r.meta.access as AccessRule | undefined, subject))) {
    return { name: 'forbidden' };
  }
  return true;
});

const APP_NAME = import.meta.env.VITE_APP_NAME || 'HRMS';

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME;
});
