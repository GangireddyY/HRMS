/**
 * iCalendar (RFC 5545) for invites and calendar feeds. Events are either all-day (dates, end exclusive) or timed (UTC).
 * Invites (METHOD:REQUEST / CANCEL) keep the same UID per thing (a leave request, an interview) and a rising SEQUENCE,
 * so calendars update or remove the existing entry instead of adding another.
 */

export interface IcsPerson {
  name: string;
  email: string;
}

export interface IcsEvent {
  /** Stable per thing, e.g. `interview-<id>@hrms`. */
  uid: string;
  /** Must rise with every change of an invite. */
  sequence: number;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** All-day: YYYY-MM-DD (end exclusive). */
  allDay?: { start: string; end: string };
  /** Timed. */
  start?: Date;
  end?: Date;
  /** Shown as busy (default) or free. */
  busy?: boolean;
  cancelled?: boolean;
  organizer?: IcsPerson | null;
  attendees?: IcsPerson[];
  stamp?: Date;
}

const CRLF = '\r\n';

/** Text value escaping: backslash, semicolon, comma, newlines. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets continue on the next line after a space (never splitting a UTF-8 character). */
export function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const date = (iso: string) => iso.replace(/-/g, '');
const person = (p: IcsPerson) => `CN=${quoteParam(p.name)}:mailto:${p.email}`;
function quoteParam(v: string): string {
  return `"${v.replace(/["\r\n]/g, '')}"`;
}

function eventLines(e: IcsEvent, method: 'REQUEST' | 'CANCEL' | 'PUBLISH'): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `SEQUENCE:${e.sequence}`, `DTSTAMP:${utc(e.stamp ?? new Date())}`];
  if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${date(e.allDay.start)}`, `DTEND;VALUE=DATE:${date(e.allDay.end)}`);
  else if (e.start && e.end) lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
  else throw new Error('An event needs all-day dates or a start and end');
  lines.push(`SUMMARY:${escapeText(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`TRANSP:${e.busy === false ? 'TRANSPARENT' : 'OPAQUE'}`);
  lines.push(`STATUS:${e.cancelled || method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`);
  if (e.organizer) lines.push(`ORGANIZER;${person(e.organizer)}`);
  for (const a of e.attendees ?? []) lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${method === 'REQUEST' ? 'NEEDS-ACTION' : 'DECLINED'};RSVP=FALSE;${person(a)}`);
  lines.push('END:VEVENT');
  return lines;
}

/** A calendar with one or more events. PUBLISH for feeds; REQUEST / CANCEL for emailed invites. */
export function buildCalendar(events: IcsEvent[], opts: { method: 'REQUEST' | 'CANCEL' | 'PUBLISH'; name?: string }): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HRMS//Calendar//EN', 'CALSCALE:GREGORIAN', `METHOD:${opts.method}`];
  if (opts.name) lines.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  for (const e of events) lines.push(...eventLines(e, opts.method));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/** A SEQUENCE that rises with every change: seconds since 2024 of the last update. */
export const sequenceOf = (updatedAt: Date) => Math.max(0, Math.floor((updatedAt.getTime() - Date.UTC(2024, 0, 1)) / 1000));
