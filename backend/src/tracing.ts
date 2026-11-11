/**
 * OpenTelemetry tracing, loaded before anything else so the instrumentations can patch HTTP, Express, PostgreSQL and
 * Redis as they are required. Off unless OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) is set;
 * the standard OTEL_* variables configure it (OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_HEADERS, OTEL_TRACES_SAMPLER…).
 * Spans carry routes and timings; request bodies and SQL parameters are not recorded.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

export const tracingEnabled = !!endpoint && process.env.NODE_ENV !== 'test';

if (tracingEnabled) {
  process.env.OTEL_SERVICE_NAME ||= 'hrms-api';
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy and low-value for an API: file system calls and DNS lookups.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // No query parameters (personal data) in spans.
        '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
        '@opentelemetry/instrumentation-http': { ignoreIncomingRequestHook: (req) => /\/api\/v1\/(health|metrics)/.test(req.url ?? '') },
      }),
    ],
  });
  sdk.start();
  const stop = () => void sdk.shutdown().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
