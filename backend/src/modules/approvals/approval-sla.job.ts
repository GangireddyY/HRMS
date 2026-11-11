import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { ApprovalChainsService } from './approval-chains.service';

const TICK_MS = 10 * 60_000;

/** Escalates approval steps past their deadline, every 10 minutes (started by the API server only). */
@Injectable()
export class ApprovalSlaJob implements OnModuleDestroy {
  private readonly logger = new Logger('ApprovalSla');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly chains: ApprovalChainsService,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.chains.escalateOverdue(now);
      if (n) this.logger.log(`Escalated ${n} overdue approval step${n === 1 ? '' : 's'}`);
      return n;
    } catch (e) {
      this.logger.warn(`Approval escalation failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
