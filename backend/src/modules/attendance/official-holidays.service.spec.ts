import { parseHolidayCalendar } from './official-holidays.service';

const event = (date: string, summary: string, description: string) =>
  ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${date}`, `SUMMARY:${summary}`, `DESCRIPTION:${description}`, 'END:VEVENT'].join('\r\n');

describe('parseHolidayCalendar', () => {
  it('reads public holidays, regional holidays and observances', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      event('20260815', 'Independence Day', 'Public holiday'),
      event('20260815', 'Parsi New Year', 'Observance\\nTo hide observances\\, go to Google Calendar Settings > Holidays in India'),
      event('20260106', 'Epiphany (regional holiday)', 'Public holiday in Baden-Württemberg\\, Bavaria\\, Saxony-Anhalt'),
      event('20261224', 'Christmas Eve (half-day)', 'Public holiday\\nThis is a half-day holiday.'),
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseHolidayCalendar(ics)).toEqual([
      { date: '2026-08-15', name: 'Independence Day', kind: 'PUBLIC', regions: [], halfDay: false },
      { date: '2026-08-15', name: 'Parsi New Year', kind: 'OBSERVANCE', regions: [], halfDay: false },
      { date: '2026-01-06', name: 'Epiphany (regional holiday)', kind: 'REGIONAL', regions: ['Baden-Württemberg', 'Bavaria', 'Saxony-Anhalt'], halfDay: false },
      { date: '2026-12-24', name: 'Christmas Eve (half-day)', kind: 'PUBLIC', regions: [], halfDay: true },
    ]);
  });

  it('joins folded lines and skips events without an all-day date', () => {
    const ics = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261002',
      'SUMMARY:Mahatma Gandhi',
      '  Jayanti',
      'DESCRIPTION:Public holiday',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261002T100000Z',
      'SUMMARY:Not a holiday',
      'END:VEVENT',
    ].join('\r\n');
    expect(parseHolidayCalendar(ics)).toEqual([{ date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', kind: 'PUBLIC', regions: [], halfDay: false }]);
  });
});
