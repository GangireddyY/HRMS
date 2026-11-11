import { describe, expect, it } from 'vitest';
import { urlBase64ToBytes } from './web-push';

describe('urlBase64ToBytes', () => {
  it('decodes URL-safe base64 without padding (VAPID public keys)', () => {
    const bytes = urlBase64ToBytes('BAAB-_8');
    expect([...bytes]).toEqual([0x04, 0x00, 0x01, 0xfb, 0xff]);
  });

  it('decodes a full 65-byte uncompressed P-256 key', () => {
    const key = 'B' + 'A'.repeat(86);
    expect(urlBase64ToBytes(key)).toHaveLength(65);
  });
});
