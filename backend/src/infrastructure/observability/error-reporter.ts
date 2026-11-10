import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AppConfig } from '../../config/app-config.service';
import { parseDsn, type Dsn } from './dsn';

/**
 * Reports unexpected errors (5xx responses, failed background jobs) to Sentry when SENTRY_DSN is set, over its
 * envelope API (no SDK). Only the error, its stack, the request id and route are sent — never request bodies,
 * headers or user data. Delivery is best effort and never affects the request.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger(ErrorReporter.name);
  private readonly dsn: Dsn | null;

  constructor(private readonly config: AppConfig) {
    this.dsn = config.isTest ? null : parseDsn(config.get('SENTRY_DSN'));
  }

  get enabled(): boolean {
    return !!this.dsn;
  }

  capture(error: unknown, context: { tags?: Record<string, string>; extra?: Record<string, unknown> } = {}): void {
    if (!this.dsn) return;
    const e = error instanceof Error ? error : new Error(String(error));
    const ctx = RequestContext.get();
    const event = {
      event_id: randomUUID().replace(/-/g, ''),
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: this.config.get('NODE_ENV'),
      release: process.env.APP_RELEASE,
      server_name: process.env.HOSTNAME,
      exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: frames(e.stack) } }] },
      tags: { requestId: ctx?.requestId ?? 'none', ...(ctx?.organizationId ? { organizationId: ctx.organizationId } : {}), ...context.tags },
      extra: context.extra,
    };
    const body = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
    fetch(this.dsn.url, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': this.dsn.auth }, body, signal: AbortSignal.timeout(5000) })
      .then((res) => {
        if (!res.ok) this.logger.warn(`Error report rejected: ${res.status}`);
      })
      .catch((err: unknown) => this.logger.warn(`Error report failed: ${(err as Error).message}`));
  }
}

/** Stack lines → Sentry frames (innermost last). */
function frames(stack: string | undefined) {
  return (stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ function: m[1] ?? '<anonymous>', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2]!.includes('node_modules') }))
    .reverse();
}
