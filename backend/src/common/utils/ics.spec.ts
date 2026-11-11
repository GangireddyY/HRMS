import { buildCalendar, escapeText, fold, sequenceOf } from './ics';

describe('ics', () => {
  it('escapes text values', () => {
    expect(escapeText('Review; budget, plan\nNext\\step')).toBe('Review\\; budget\\, plan\\nNext\\\\step');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `DESCRIPTION:${'₹'.repeat(40)}`;
    const folded = fold(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(folded.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('builds an all-day invite and a timed cancellation', () => {
    const invite = buildCalendar(
      [{ uid: 'leave-1@hrms', sequence: 3, summary: 'Out of office: Casual leave', allDay: { start: '2026-11-16', end: '2026-11-19' }, organizer: { name: 'Acme HR', email: 'no-reply@acme.test' }, attendees: [{ name: 'Asha Rao', email: 'asha@acme.test' }], stamp: new Date('2026-11-11T10:00:00Z') }],
      { method: 'REQUEST' },
    );
    expect(invite).toContain('METHOD:REQUEST\r\n');
    expect(invite).toContain('DTSTART;VALUE=DATE:20261116\r\n');
    expect(invite).toContain('DTEND;VALUE=DATE:20261119\r\n');
    expect(invite).toContain('SEQUENCE:3\r\n');
    expect(invite.replace(/\r\n /g, '')).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE;CN="Asha Rao":mailto:asha@acme.test');
    expect(invite.endsWith('END:VCALENDAR\r\n')).toBe(true);

    const cancel = buildCalendar([{ uid: 'interview-9@hrms', sequence: 4, summary: 'Interview', start: new Date('2026-11-20T09:30:00Z'), end: new Date('2026-11-20T10:30:00Z') }], { method: 'CANCEL' });
    expect(cancel).toContain('DTSTART:20261120T093000Z');
    expect(cancel).toContain('STATUS:CANCELLED');
  });

  it('sequence rises with updates', () => {
    expect(sequenceOf(new Date('2026-01-01T00:00:01Z'))).toBeGreaterThan(sequenceOf(new Date('2026-01-01T00:00:00Z')));
  });
});
