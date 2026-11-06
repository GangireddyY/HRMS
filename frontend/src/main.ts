import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '@/App.vue';
import { configureHttpAuth } from '@/core/http/http-client';
import { router } from '@/app/router';
import { useAuthStore } from '@/core/auth/auth.store';
import { useThemeStore } from '@/core/theme/theme.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import '@/app/styles/main.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const auth = useAuthStore();
const feedback = useFeedbackStore();
useThemeStore();

configureHttpAuth({
  getToken: () => auth.accessToken,
  refresh: () => auth.refresh(),
  onSessionEnded: () => auth.sessionEnded(),
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
