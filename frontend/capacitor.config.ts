import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The store app wraps the hosted HRMS web app (HRMS_APP_URL, e.g. https://hrms.example.com): sign-in cookies stay
 * first-party and every deploy reaches phones without a store release. After the first launch the web app's service
 * worker serves it offline (iOS: the host must be listed in WKAppBoundDomains). Native features (push, location,
 * deep links, back button) go through `src/core/native`.
 */
const url = process.env.HRMS_APP_URL;
if (process.env.CAPACITOR_REQUIRE_URL === 'true' && !url) throw new Error('Set HRMS_APP_URL to the HTTPS address of the HRMS web app');
const host = url ? new URL(url).host : undefined;

const config: CapacitorConfig = {
  appId: process.env.HRMS_APP_ID ?? 'com.nitya.hrms',
  appName: 'HRMS',
  // The site is loaded from HRMS_APP_URL; the bundle only carries a placeholder page.
  webDir: 'native-shell',
  server: url
    ? {
        url,
        // Only the HRMS site opens inside the app; other links go to the browser.
        allowNavigation: host ? [host] : [],
      }
    : undefined,
  android: { allowMixedContent: false, webContentsDebuggingEnabled: process.env.HRMS_APP_DEBUG === 'true' },
  ios: { contentInset: 'automatic', limitsNavigationsToAppBoundDomains: true },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
