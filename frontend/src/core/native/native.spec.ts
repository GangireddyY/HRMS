import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPath, currentPosition, isNativeApp, nativePlatform } from './native';

describe('native app helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a browser outside the app', () => {
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it('opens only HRMS paths from notifications and links', () => {
    const origin = 'https://hrms.example.com';
    expect(appPath('/hr/leave/requests?id=1', origin)).toBe('/hr/leave/requests?id=1');
    expect(appPath('https://hrms.example.com/me/payslips#latest', origin)).toBe('/me/payslips#latest');
    expect(appPath('https://evil.example.com/me', origin)).toBeNull();
    expect(appPath('//evil.example.com/me', origin)).toBeNull();
    expect(appPath('javascript:alert(1)', origin)).toBeNull();
    expect(appPath(null, origin)).toBeNull();
  });

  it('reads the browser position, rounded, and resolves empty when refused', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback, _fail: PositionErrorCallback, opts?: PositionOptions) => {
      expect(opts).toMatchObject({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
      ok({ coords: { latitude: 17.4448311234, longitude: 78.3498123456 } } as GeolocationPosition);
    });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    expect(await currentPosition({ accurate: true })).toEqual({ latitude: 17.444831, longitude: 78.349812 });

    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) } });
    expect(await currentPosition({ accurate: false })).toEqual({});
    vi.stubGlobal('navigator', {});
    expect(await currentPosition({ accurate: false })).toEqual({});
  });
});
