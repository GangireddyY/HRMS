import { Capacitor } from '@capacitor/core';

/** True inside the Android / iOS app (Capacitor), false in a browser, including the installed web app. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): 'ANDROID' | 'IOS' | null {
  const p = Capacitor.getPlatform();
  return p === 'android' ? 'ANDROID' : p === 'ios' ? 'IOS' : null;
}

/** An in-app path from a notification or a link into the HRMS site; anything else is ignored. */
export function appPath(link: string | null | undefined, origin: string): string | null {
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export interface Position {
  latitude?: number;
  longitude?: number;
}

/**
 * The device's position for punching in: the app asks through the OS permission prompt, the browser through the
 * Geolocation API. Resolves empty when unavailable or refused.
 */
export async function currentPosition(opts: { accurate: boolean }): Promise<Position> {
  const round = (c: { latitude: number; longitude: number }) => ({ latitude: Number(c.latitude.toFixed(6)), longitude: Number(c.longitude.toFixed(6)) });
  const options = { timeout: opts.accurate ? 10_000 : 4000, maximumAge: opts.accurate ? 0 : 60_000, enableHighAccuracy: opts.accurate };
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted' && (await Geolocation.requestPermissions({ permissions: ['location'] })).location !== 'granted') return {};
      return round((await Geolocation.getCurrentPosition(options)).coords);
    } catch {
      return {};
    }
  }
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return {};
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(round(p.coords)),
      () => resolve({}),
      options,
    );
  });
}
