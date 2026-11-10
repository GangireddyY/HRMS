import { Injectable, Logger } from '@nestjs/common';
import { Op } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { HOLIDAY_COUNTRIES, type HolidayCountry, type OfficialHolidayKind } from '../../contracts';
import { DatabaseService } from '../../database/database.service';
import { Holiday, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { holidayClash, knownLocations } from './attendance-rules.service';
import type { ImportHolidaysDto } from './dto/attendance.dto';

/** Google's public holiday calendars (no key needed); each covers the past few years and the next one or two. */
const CALENDAR_IDS: Record<HolidayCountry, string> = {
  IN: 'en.indian',
  AE: 'en.ae',
  AU: 'en.australian',
  BD: 'en.bd',
  CA: 'en.canadian',
  DE: 'en.german',
  FR: 'en.french',
  GB: 'en.uk',
  IE: 'en.irish',
  JP: 'en.japanese',
  LK: 'en.lk',
  MY: 'en.malaysia',
  NP: 'en.np',
  NZ: 'en.new_zealand',
  PH: 'en.philippines',
  QA: 'en.qa',
  SA: 'en.saudiarabian',
  SG: 'en.singapore',
  US: 'en.usa',
  ZA: 'en.sa',
};
const CACHE_MS = 12 * 3_600_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface OfficialHoliday {
  date: string;
  name: string;
  kind: OfficialHolidayKind;
  /** States or regions where a REGIONAL holiday is a day off. */
  regions: string[];
  halfDay: boolean;
}

/** iCalendar text: TEXT values escape `\`, `,`, `;` and newlines. */
const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Reads the all-day events of a public holiday calendar (iCalendar), keeping how Google labels each one. */
export function parseHolidayCalendar(ics: string): OfficialHoliday[] {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: OfficialHoliday[] = [];
  let event: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') event = {};
    else if (line === 'END:VEVENT' && event) {
      const date = /^(\d{4})(\d{2})(\d{2})$/.exec(event.DTSTART ?? '');
      const name = unescape(event.SUMMARY ?? '').trim();
      if (date && name) {
        const description = unescape(event.DESCRIPTION ?? '');
        const first = description.split('\n')[0]!.trim();
        const regional = /^(?:Public holiday|Observance) in (.+)$/.exec(first);
        const kind: OfficialHolidayKind = first === 'Public holiday' ? 'PUBLIC' : regional && first.startsWith('Public') ? 'REGIONAL' : 'OBSERVANCE';
        out.push({
          date: `${date[1]}-${date[2]}-${date[3]}`,
          name: name.slice(0, 120),
          kind,
          regions: regional
            ? regional[1]!
                .split(',')
                .map((r) => r.trim())
                .filter(Boolean)
            : [],
          halfDay: /half-day holiday/i.test(description),
        });
      }
      event = null;
    } else if (event) {
      const colon = line.indexOf(':');
      if (colon > 0) event[line.slice(0, colon).split(';')[0]!] = line.slice(colon + 1);
    }
  }
  return out;
}

/** Official public holidays by country, and importing the ones the organization gives into its holiday calendar. */
@Injectable()
export class OfficialHolidaysService {
  private readonly logger = new Logger(OfficialHolidaysService.name);
  private readonly cache = new Map<HolidayCountry, { at: number; holidays: OfficialHoliday[] }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** The organization's country when the calendar is available for it, otherwise India. */
  async defaultCountry(organizationId: string): Promise<HolidayCountry> {
    const org = await Organization.findByPk(organizationId, { attributes: ['country'] });
    const code = org?.country?.toUpperCase();
    return code && code in HOLIDAY_COUNTRIES ? (code as HolidayCountry) : 'IN';
  }

  /** Holidays of `year`, each with the organization's existing holiday on that date (if any). */
  async list(auth: AuthContext, year: number, country?: HolidayCountry) {
    const code = country ?? (await this.defaultCountry(auth.organizationId!));
    const [all, existing] = await Promise.all([this.calendar(code), Holiday.findAll({ where: { date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } }, attributes: ['date', 'name'] })]);
    const taken = new Map(existing.map((h) => [h.date, h.name]));
    const holidays = all
      .filter((h) => h.date.startsWith(`${year}-`))
      .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((h) => ({ ...h, existing: taken.get(h.date) ?? null }));
    return { country: code, countryName: HOLIDAY_COUNTRIES[code], year, holidays };
  }

  /** Adds the chosen holidays (for every location, or the chosen ones); dates already covered there are left as they are. */
  async import(auth: AuthContext, dto: ImportHolidaysDto) {
    const dates = dto.holidays.map((h) => h.date);
    if (new Set(dates).size !== dates.length) throw AppError.validation([{ field: 'holidays', message: 'Choose one holiday per date' }]);
    return this.db.transaction(async (transaction) => {
      const batch = await knownLocations(dto.locationIds, transaction);
      const fresh: (ImportHolidaysDto['holidays'][number] & { locationIds: string[] })[] = [];
      for (const h of dto.holidays) {
        const locationIds = h.locationIds?.length ? await knownLocations(h.locationIds, transaction) : batch;
        if (!(await holidayClash(h.date, locationIds, transaction))) fresh.push({ ...h, locationIds });
      }
      if (fresh.length) {
        await Holiday.bulkCreate(
          fresh.map((h) => ({
            date: h.date,
            name: h.name,
            isOptional: h.isOptional ?? false,
            locationIds: h.locationIds,
            organizationId: auth.organizationId!,
            createdById: auth.userId,
            updatedById: auth.userId,
          })),
          { transaction },
        );
        await this.audit.record(
          {
            action: 'holiday.imported',
            entityType: 'Holiday',
            summary: `${fresh.length} official holiday${fresh.length === 1 ? '' : 's'} imported${dto.country ? ` (${HOLIDAY_COUNTRIES[dto.country]})` : ''}`,
            metadata: { country: dto.country ?? null, locationIds: batch, holidays: fresh.map((h) => `${h.date} ${h.name}${h.isOptional ? ' (optional)' : ''}`) },
          },
          transaction,
        );
      }
      return { created: fresh.length, skipped: dto.holidays.length - fresh.length };
    });
  }

  private async calendar(country: HolidayCountry): Promise<OfficialHoliday[]> {
    const hit = this.cache.get(country);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.holidays;
    const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(`${CALENDAR_IDS[country]}#holiday@group.v.calendar.google.com`)}/public/basic.ics`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const holidays = parseHolidayCalendar(await res.text());
      this.cache.set(country, { at: Date.now(), holidays });
      return holidays;
    } catch (e) {
      this.logger.warn(`Official holidays for ${country} could not be fetched: ${e instanceof Error ? e.message : String(e)}`);
      if (hit) return hit.holidays;
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The official holiday calendar could not be reached. Try again in a minute, or add holidays by hand.');
    }
  }
}
