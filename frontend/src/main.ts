import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { setAppCurrency } from '@/core/locale/currency';
import App from '@/App.vue';
import { configureHttpAuth } from '@/core/http/http-client';
import { router } from '@/app/router';
import { initNativeApp } from '@/app/native-app';
import { useAuthStore } from '@/core/auth/auth.store';
import { requestStepUp } from '@/core/auth/step-up';
import { useThemeStore } from '@/core/theme/theme.store';
import { applyLocale } from '@/core/locale/locale';
import { syncAppearance } from '@/core/theme/appearance-sync';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import '@/app/styles/main.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const auth = useAuthStore();
const feedback = useFeedbackStore();
const theme = useThemeStore();
applyLocale(document.documentElement);
syncAppearance(auth, theme);
// Amounts follow the active organization's currency.
watch(() => auth.organization?.currency, setAppCurrency, { immediate: true });

configureHttpAuth({
  getToken: () => auth.accessToken,
  refresh: () => auth.refresh(),
  onSessionEnded: () => auth.sessionEnded(),
  stepUp: (message) => requestStepUp(message),
});

auth.onSessionEnded(() => {
  feedback.warning('Your session has ended', 'Please sign in again.');
  const current = router.currentRoute.value;
  if (!current.meta.public) void router.push({ name: 'login', query: { redirect: current.fullPath } });
});

app.config.errorHandler = (err) => {
  console.error(err);
  feedback.error('Unexpected error', err);
};

app.use(router);
app.mount('#app');
void initNativeApp(router, auth);

// Installable app and offline shell (production builds only: the dev server serves unhashed modules).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
