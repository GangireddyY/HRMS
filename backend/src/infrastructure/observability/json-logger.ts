import type { LoggerService, LogLevel } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';

const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/**
 * One JSON object per line (production): time, level, context, message, the request / job id and organization, and
 * the stack for errors — ready for log shippers (CloudWatch, Loki, Datadog) without parsing.
 */
export class JsonLogger implements LoggerService {
  private enabled: Set<LogLevel>;

  constructor(levels: LogLevel[] = ['fatal', 'error', 'warn', 'log']) {
    this.enabled = new Set(levels);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.enabled = new Set(levels);
  }

  log(message: unknown, ...rest: unknown[]) {
    this.write('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.write('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.write('fatal', message, rest);
  }

  /** Nest passes optional (stack, context) / (context) after the message. */
  private write(level: LogLevel, message: unknown, rest: unknown[]) {
    if (!this.enabled.has(level)) return;
    const args = [...rest];
    const context = typeof args[args.length - 1] === 'string' ? (args.pop() as string) : undefined;
    const stack = level === 'error' || level === 'fatal' ? (args.find((a) => typeof a === 'string' && a.includes('\n    at ')) as string | undefined) : undefined;
    const ctx = RequestContext.get();
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      context,
      message: message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message),
      requestId: ctx?.requestId,
      organizationId: ctx?.organizationId,
      stack: stack ?? (message instanceof Error ? message.stack : undefined),
    };
    const line = JSON.stringify(entry) + '\n';
    if (LEVELS.indexOf(level) <= 2) process.stderr.write(line);
    else process.stdout.write(line);
  }
}
