import { addDays } from '../../common/utils/zoned-time';

export interface Step {
  shiftId: string | null;
  days: number;
}

export interface Span {
  shiftId: string | null;
  from: string;
  to: string;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const cycleLength = (pattern: Step[]) => pattern.reduce((n, s) => n + s.days, 0);

/**
 * Lays a rotation over a date range. `offset` days into the cycle is where `from` falls (e.g. to stagger teams).
 * Consecutive days on the same shift are merged into one span.
 */
export function rotationSpans(pattern: Step[], from: string, to: string, offset = 0): Span[] {
  const length = cycleLength(pattern);
  if (!length) return [];
  const slots = pattern.flatMap((s) => Array.from({ length: s.days }, () => s.shiftId));
  const spans: Span[] = [];
  const total = daysBetween(from, to);
  for (let i = 0; i <= total; i++) {
    const date = addDays(from, i);
    const shiftId = slots[(((i + offset) % length) + length) % length]!;
    const last = spans[spans.length - 1];
    if (last && last.shiftId === shiftId) last.to = date;
    else spans.push({ shiftId, from: date, to: date });
  }
  return spans;
}

/**
 * What remains of an existing span after clearing [from, to]: nothing, one piece, or two pieces around the gap.
 */
export function carve(span: { from: string; to: string }, from: string, to: string): { from: string; to: string }[] {
  if (span.to < from || span.from > to) return [span];
  const pieces: { from: string; to: string }[] = [];
  if (span.from < from) pieces.push({ from: span.from, to: addDays(from, -1) });
  if (span.to > to) pieces.push({ from: addDays(to, 1), to: span.to });
  return pieces;
}
