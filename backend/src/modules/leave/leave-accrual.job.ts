import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { LEAVE_ACCRUAL_JOB_FROM_MINUTES } from '../../contracts';
import { RequestContext } from '../../common/context/request-context';
import { zonedParts } from '../../common/utils/zoned-time';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { AccessService } from '../rbac/access.service';
import { LeaveBalanceService } from './leave-balance.service';

const TICK_MS = 30 * 60_000;

/**
 * Brings leave up to date every night: monthly and yearly accruals, carry-forward and lapse at the start of a leave
 * year, and comp-off expiry, for every active organization using leave, from 1:00 their time. Balances are also
 * brought up to date whenever they are read, so this keeps reports and notifications current; each organization's
 * night is claimed with one conditional update, so it runs once even with several servers. API server only.
 */
@Injectable()
export class LeaveAccrualJob implements OnModuleDestroy {
  private readonly logger = new Logger('LeaveAccruals');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly balances: LeaveBalanceService,
    private readonly access: AccessService,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 90_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      const orgs = await this.db.select<{ id: string; timezone: string | null }>(`SELECT id, timezone FROM organizations WHERE status = 'ACTIVE'`);
      for (const org of orgs) {
        try {
          if (await this.forOrganization(org.id, org.timezone ?? 'UTC', now)) done++;
        } catch (e) {
          this.logger.warn(`Organization ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Accrual run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
    return done;
  }

  private async forOrganization(organizationId: string, timeZone: string, now: Date): Promise<boolean> {
    const { date: today, minutes } = zonedParts(now, timeZone);
    if (minutes < LEAVE_ACCRUAL_JOB_FROM_MINUTES) return false;
    if (!(await this.access.entitlements(organizationId)).has('leave')) return false;
    const claimed = await this.db.select<{ id: string }>(
      `UPDATE organizations SET leave_accruals_run_on = :today WHERE id = :organizationId AND (leave_accruals_run_on IS NULL OR leave_accruals_run_on < :today) RETURNING id`,
      { organizationId, today },
    );
    if (!claimed.length) return false;
    const result = await RequestContext.runForTenant(organizationId, () => this.balances.accrueAll(organizationId), { requestId: `job-leave-accruals-${today}` });
    if (result.entries) this.logger.log(`Leave brought up to date for ${organizationId}: ${result.entries} entries for ${result.employees} people`);
    return true;
  }
}
