import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Prometheus metrics for the API process, scraped from `GET /api/v1/metrics` (see deploy/prometheus/alerts.yml). */
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: 'hrms-api' });
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequests = new Counter({
  name: 'hrms_http_requests_total',
  help: 'HTTP requests by method, route pattern and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});

export const httpDuration = new Histogram({
  name: 'hrms_http_request_duration_seconds',
  help: 'HTTP request duration by method and route pattern',
  labelNames: ['method', 'route'] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const jobRuns = new Counter({
  name: 'hrms_jobs_total',
  help: 'Background job attempts by type and outcome (done, retry, failed)',
  labelNames: ['type', 'outcome'] as const,
  registers: [metricsRegistry],
});

export const jobQueue = new Gauge({
  name: 'hrms_job_queue',
  help: 'Background jobs pending, failed (dead), and the age of the oldest due job in seconds',
  labelNames: ['state'] as const,
  registers: [metricsRegistry],
});

export const authFailures = new Counter({
  name: 'hrms_auth_failures_total',
  help: 'Failed sign-ins by outcome (FAILURE, LOCKED)',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

/** Route patterns (`/api/v1/employees/:id`), never raw URLs, so ids don't explode the label set. */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : 'unmatched';
    end({ method: req.method, route });
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}
