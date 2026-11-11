import type { ReportFrequency } from '../../../contracts';
import { addDays, weekday, zonedInstant, zonedParts } from '../../../common/utils/zoned-time';

export interface ScheduleTiming {
  frequency: ReportFrequency;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour: number;
}

/** The first run strictly after `after`: the schedule's local hour in `timeZone`, on its weekday / day of the month. */
export function nextRunAt(s: ScheduleTiming, after: Date, timeZone: string): Date {
  const { date } = zonedParts(after, timeZone);
  for (let i = 0; i <= 62; i++) {
    const day = addDays(date, i);
    if (s.frequency === 'WEEKLY' && ((weekday(day) + 6) % 7) + 1 !== s.dayOfWeek) continue;
    if (s.frequency === 'MONTHLY' && Number(day.slice(8)) !== s.dayOfMonth) continue;
    const at = zonedInstant(day, s.hour * 60, timeZone);
    if (at > after) return at;
  }
  throw new Error(`No run time found for a ${s.frequency.toLowerCase()} schedule`);
}
