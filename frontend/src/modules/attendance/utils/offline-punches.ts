/**
 * Punches made without a connection are kept on this device and sent when it's back. The server only records the
 * time it receives a punch, so one sent more than a few minutes late is followed by a suggested correction with the
 * time it was actually made (a regularization request the manager approves) — the device clock is never trusted.
 */
export type PunchKind = 'IN' | 'OUT';
export interface QueuedPunch {
  kind: PunchKind;
  /** When it was made (device clock), ISO. */
  at: string;
  /** The organization's calendar date and HH:MM at that moment. */
  date: string;
  time: string;
  latitude?: number;
  longitude?: number;
  /** Camera photo (data URL) where the location asks for one. */
  photo?: string;
}
export interface PunchCorrection extends QueuedPunch {
  /** When the server recorded it. */
  recordedAt: string;
}

/** Sent within this long, the server's time is close enough; later, suggest a correction. */
export const ON_TIME_MS = 5 * 60_000;

const key = (kind: 'queue' | 'corrections', userId: string) => `hrms.offlinePunches.${kind}.${userId}`;
const read = <T>(k: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]') as T[];
  } catch {
    return [];
  }
};
const write = (k: string, v: unknown[]) => (v.length ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k));

export const queuedPunches = (userId: string) => read<QueuedPunch>(key('queue', userId));
export function queuePunch(userId: string, p: QueuedPunch) {
  const list = queuedPunches(userId);
  // Two of the same in a row (a double tap while offline) count once.
  if (list.at(-1)?.kind !== p.kind) list.push(p);
  write(key('queue', userId), list);
}
export const setQueuedPunches = (userId: string, list: QueuedPunch[]) => write(key('queue', userId), list);

export const punchCorrections = (userId: string) => read<PunchCorrection>(key('corrections', userId));
export function addPunchCorrection(userId: string, c: PunchCorrection) {
  write(key('corrections', userId), [...punchCorrections(userId), c].slice(-10));
}
export function dismissPunchCorrection(userId: string, at: string) {
  write(key('corrections', userId), punchCorrections(userId).filter((c) => c.at !== at));
}
