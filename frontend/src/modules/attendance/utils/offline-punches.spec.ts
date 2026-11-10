import { beforeEach, describe, expect, it } from 'vitest';
import { addPunchCorrection, dismissPunchCorrection, punchCorrections, queuePunch, queuedPunches, setQueuedPunches } from './offline-punches';

describe('offline punches', () => {
  beforeEach(() => localStorage.clear());
  const punch = (kind: 'IN' | 'OUT', time: string) => ({ kind, at: `2026-11-10T${time}:00.000Z`, date: '2026-11-10', time });

  it('queues per user and ignores a repeated tap of the same punch', () => {
    queuePunch('u1', punch('IN', '09:02'));
    queuePunch('u1', punch('IN', '09:03'));
    queuePunch('u1', punch('OUT', '18:01'));
    expect(queuedPunches('u1').map((p) => `${p.kind} ${p.time}`)).toEqual(['IN 09:02', 'OUT 18:01']);
    expect(queuedPunches('u2')).toEqual([]);
    setQueuedPunches('u1', []);
    expect(localStorage.getItem('hrms.offlinePunches.queue.u1')).toBeNull();
  });

  it('keeps late punches as suggested corrections until dismissed', () => {
    addPunchCorrection('u1', { ...punch('IN', '09:02'), recordedAt: '2026-11-10T10:15:00.000Z' });
    expect(punchCorrections('u1')).toHaveLength(1);
    dismissPunchCorrection('u1', '2026-11-10T09:02:00.000Z');
    expect(punchCorrections('u1')).toEqual([]);
  });
});
