import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { timesheetDueDate } from '../../contracts';
import { RequestContext } from '../../common/context/request-context';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { AccessService } from '../rbac/access.service';
import { latestDueWeek, weekLabel } from './timesheet-rules';
import { TimesheetsService } from './timesheets.service';

const TICK_MS = 15 * 60_000;
/** Reminders go out from this local time (minutes after midnight in the organization's time zone). */
export const REMIND_FROM_MINUTES = 9 * 60;
/** A missed overdue reminder (server down) is still sent this many days after the due date, not later. */
const OVERDUE_CATCH_UP_DAYS = 3;

interface Candidate {
  id: string;
  timezone: string | null;
  dueWeekday: number;
  from: string | null;
}

/** Which reminder (if any) is due for an organization at a local date and time. */
export function reminderDue(today: string, minutes: number, dueWeekday: number, from: string | null): { kind: 'DUE' | 'OVERDUE'; week: string } | null {
  if (minutes < REMIND_FROM_MINUTES) return null;
  const week = latestDueWeek(today, dueWeekday);
  if (from && addDays(week, 6) < from) return null;
  const due = timesheetDueDate(week, dueWeekday);
  if (today === due) return { kind: 'DUE', week };
  if (today > due && today <= addDays(due, OVERDUE_CATCH_UP_DAYS)) return { kind: 'OVERDUE', week };
  return null;
}

/**
 * Sends the automatic timesheet reminders. Every 15 minutes it looks at organizations that require timesheets with
 * automatic reminders on and, from 9:00 their time, reminds people on the due day and again the day after. Each
 * reminder is claimed with a single conditional update, so it goes out once even with several servers.
 * Started by the API server only (not by seeds or scripts that boot the app).
 */
@Injectable()
export class TimesheetReminderJob implements OnModuleDestroy {
  private readonly logger = new Logger('TimesheetReminders');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly timesheets: TimesheetsService,
    private readonly access: AccessService,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 60_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.db.select<Candidate>(
        `SELECT s.organization_id AS id, o.timezone, s.timesheet_due_weekday AS "dueWeekday", to_char(s.timesheets_from, 'YYYY-MM-DD') AS "from"
           FROM payroll_settings s JOIN organizations o ON o.id = s.organization_id
          WHERE s.timesheets_required AND s.timesheet_auto_remind AND o.status = 'ACTIVE'`,
      );
      for (const org of orgs) {
        try {
          await this.forOrganization(org, now);
        } catch (e) {
          this.logger.warn(`Organization ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Reminder run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async forOrganization(org: Candidate, now: Date): Promise<void> {
    const { date: today, minutes } = zonedParts(now, org.timezone ?? 'UTC');
    const due = reminderDue(today, minutes, Number(org.dueWeekday), org.from);
    if (!due) return;
    if (!(await this.access.entitlements(org.id)).has('attendance')) return;
    if (!(await this.claim(org.id, due.kind, due.week))) return;
    const result = await RequestContext.runForTenant(org.id, () => this.timesheets.autoRemind(org.id, due.week, due.kind), { requestId: `job-timesheets-${due.kind.toLowerCase()}-${due.week}` });
    this.logger.log(`${due.kind === 'DUE' ? 'Due-day' : 'Overdue'} reminders for the week of ${weekLabel(due.week)} (${org.id}): ${result.reminded} people, ${result.managers} managers`);
  }

  /** Marks the week as reminded for this kind; false when another run (or server) already did. */
  private async claim(organizationId: string, kind: 'DUE' | 'OVERDUE', week: string): Promise<boolean> {
    const column = kind === 'DUE' ? 'timesheet_due_reminded' : 'timesheet_overdue_reminded';
    const rows = await this.db.select<{ id: string }>(
      `UPDATE payroll_settings SET ${column} = :week, updated_at = now() WHERE organization_id = :organizationId AND (${column} IS NULL OR ${column} < :week) RETURNING organization_id AS id`,
      { organizationId, week },
    );
    return rows.length > 0;
  }
}
