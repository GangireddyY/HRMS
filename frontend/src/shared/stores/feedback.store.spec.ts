import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeedbackStore } from './feedback.store';

describe('feedback store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('shows toasts and hides them after a while (errors stay longer)', () => {
    const f = useFeedbackStore();
    f.success('Saved', 'All good');
    f.info('Heads up');
    f.warning('Careful');
    f.error('Failed', new Error('Network down'));
    expect(f.toasts.map((t) => t.kind)).toEqual(['success', 'info', 'warning', 'error']);
    expect(f.toasts[3]!.message).toBe('Network down');
    vi.advanceTimersByTime(4600);
    expect(f.toasts.map((t) => t.kind)).toEqual(['error']);
    vi.advanceTimersByTime(4000);
    expect(f.toasts).toEqual([]);
  });

  it('dismisses a toast on request', () => {
    const f = useFeedbackStore();
    f.success('One');
    f.success('Two');
    f.dismiss(f.toasts[0]!.id);
    expect(f.toasts.map((t) => t.title)).toEqual(['Two']);
  });

  it('resolves confirmations, and a new one cancels the open one', async () => {
    const f = useFeedbackStore();
    const first = f.confirm({ title: 'Delete?', message: 'Gone for good' });
    const second = f.confirm({ title: 'Archive?', message: 'Can be restored', danger: true });
    await expect(first).resolves.toBe(false);
    expect(f.confirmation?.title).toBe('Archive?');
    f.settle(true);
    await expect(second).resolves.toBe(true);
    expect(f.confirmation).toBeNull();
  });
});
