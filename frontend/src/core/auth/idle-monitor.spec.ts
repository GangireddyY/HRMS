import { describe, expect, it } from 'vitest';
import { IDLE_WARNING_MS, idleState } from './idle-monitor';

const MIN = 60_000;

describe('idle state', () => {
  it('is active until the warning window, then warns, then expires', () => {
    const last = 0;
    const timeout = 30 * MIN;
    expect(idleState(last, 10 * MIN, timeout).state).toBe('active');
    expect(idleState(last, timeout - IDLE_WARNING_MS + 1000, timeout)).toEqual({ state: 'warning', remainingMs: IDLE_WARNING_MS - 1000 });
    expect(idleState(last, timeout, timeout)).toEqual({ state: 'expired', remainingMs: 0 });
  });

  it('keeps the warning to at most half of a very short timeout', () => {
    const timeout = 3 * MIN;
    expect(idleState(0, 1 * MIN, timeout).state).toBe('active');
    expect(idleState(0, 2 * MIN, timeout).state).toBe('warning');
  });
});
