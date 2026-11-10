import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { PrivacyService } from './privacy.service';

const TICK_MS = 60 * 60_000;

/**
 * Anonymizes candidates who weren't hired once their retention period has passed, once a day per organization.
 * Each organization's daily run is claimed with one upsert, so it happens once even with several servers.
 * Started by the API server only.
 */
@Injectable()
export class PrivacyRetentionJob implements OnModuleDestroy {
  private readonly logger = new Logger('PrivacyRetention');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly privacy: PrivacyService,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5 * 60_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.db.select<{ id: string }>(
        `INSERT INTO privacy_settings (organization_id, candidates_purged_at, created_at, updated_at)
         SELECT o.id, now(), now(), now() FROM organizations o WHERE o.status = 'ACTIVE'
         ON CONFLICT (organization_id) DO UPDATE SET candidates_purged_at = now()
           WHERE privacy_settings.candidate_retention_months > 0
             AND (privacy_settings.candidates_purged_at IS NULL OR privacy_settings.candidates_purged_at < now() - interval '20 hours')
         RETURNING organization_id AS id`,
      );
      for (const org of orgs) {
        try {
          await RequestContext.runForTenant(org.id, () => this.privacy.purgeCandidates(org.id, null), { requestId: 'job-privacy-candidates' });
        } catch (e) {
          this.logger.warn(`Organization ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Retention run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}

