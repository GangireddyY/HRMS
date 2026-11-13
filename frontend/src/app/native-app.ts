import { watch } from 'vue';
import type { Router } from 'vue-router';
import type { useAuthStore } from '@/core/auth/auth.store';
import { appPath, isNativeApp, nativePlatform } from '@/core/native/native';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';

const TOKEN_KEY = 'hrms:app-push-token';

/**
 * Inside the Android / iOS app: the hardware back button navigates back, links into HRMS and notification taps
 * open in the app, and the app registers for push notifications while someone is signed in (removed on sign-out).
 */
export async function initNativeApp(router: Router, auth: ReturnType<typeof useAuthStore>): Promise<void> {
  if (!isNativeApp()) return;
  const [{ App }, { PushNotifications }, { Device }] = await Promise.all([import('@capacitor/app'), import('@capacitor/push-notifications'), import('@capacitor/device')]);
  const open = (link: string | null | undefined) => {
    const path = appPath(link, window.location.origin);
    if (path) void router.push(path);
  };

  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) router.back();
    else void App.minimizeApp();
  });
  await App.addListener('appUrlOpen', ({ url }) => open(url));

  await PushNotifications.addListener('registration', async ({ value }) => {
    const [device, app] = await Promise.all([Device.getInfo(), App.getInfo()]);
    try {
      await notificationsApi.registerApp({ platform: nativePlatform()!, token: value, deviceName: `${device.manufacturer} ${device.model}`.trim().slice(0, 120), appVersion: app.version });
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // The server has app notifications switched off; the app works without them.
    }
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => open((notification.data as { url?: string } | undefined)?.url));

  async function register() {
    try {
      if (!(await notificationsApi.pushStatus()).nativeEnabled) return;
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions();
      if (permission.receive === 'granted') await PushNotifications.register();
    } catch {
      // No Firebase configuration in this build, or the person declined.
    }
  }
  auth.beforeLogout(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    localStorage.removeItem(TOKEN_KEY);
    await notificationsApi.unregisterApp(token).catch(() => undefined);
  });
  watch(
    () => auth.user?.id,
    (id, previous) => {
      if (id && id !== previous) void register();
    },
    { immediate: true },
  );
}
