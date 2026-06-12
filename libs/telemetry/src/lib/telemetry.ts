/**
 * Service-level OpenTelemetry bootstrap (HELIX-137). One call at service start
 * (`initTelemetry`) stands up a tracer provider carrying the standard
 * `service.name` resource, with the **exporter as the seam**: tests inject an
 * in-memory exporter, dev can switch on the console exporter via env, and the
 * real OTLP→collector push is the deferred binding (an exporter drop-in — see
 * DEFERRED.md). The agent-side span model + `OtelTraceSink` (HELIX-65/66) plug
 * into the returned `Tracer`, so per-run spans flow through the same pipeline.
 */
import { trace, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

export interface TelemetryOptions {
  /** Standard OTel `service.name` resource attribute (e.g. `registry`). */
  serviceName: string;
  /** Optional `deployment.environment` resource attribute (e.g. `dev`, `prod`). */
  environment?: string;
  /**
   * Where finished spans go. Defaults to {@link exporterFromEnv}; with no
   * exporter the provider runs with no processors (a structural no-op).
   */
  exporter?: SpanExporter;
  /** Export synchronously per span instead of batching (tests/dev). */
  simple?: boolean;
  /** Also register as the process-global tracer provider (`trace.getTracer`). */
  global?: boolean;
}

export interface Telemetry {
  /** Service-named tracer to create spans with (feed it to `OtelTraceSink`). */
  tracer: Tracer;
  provider: BasicTracerProvider;
  serviceName: string;
  /** Flush pending spans and shut the provider down (call on service close). */
  shutdown(): Promise<void>;
}

/** Stand up the OTel tracer provider for one service. */
export function initTelemetry(options: TelemetryOptions): Telemetry {
  const resource = resourceFromAttributes({
    'service.name': options.serviceName,
    ...(options.environment ? { 'deployment.environment': options.environment } : {}),
  });

  const exporter = options.exporter ?? exporterFromEnv();
  const spanProcessors: SpanProcessor[] = exporter
    ? [options.simple ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter)]
    : [];

  const provider = new BasicTracerProvider({ resource, spanProcessors });
  if (options.global) trace.setGlobalTracerProvider(provider);

  return {
    tracer: provider.getTracer(options.serviceName),
    provider,
    serviceName: options.serviceName,
    shutdown: () => provider.shutdown(),
  };
}

/** Default OTLP/HTTP traces endpoint (the local `observability/` collector). */
const DEFAULT_OTLP_TRACES_URL = 'http://localhost:4318/v1/traces';

/**
 * Pick the span exporter from the environment (HELIX-137/138):
 * - `OTEL_TRACE_EXPORTER=console` → print finished spans to stdout (dev).
 * - `OTEL_TRACE_EXPORTER=otlp` *or* `OTEL_EXPORTER_OTLP_ENDPOINT=…` → OTLP/HTTP
 *   to the collector (the `observability/` compose stack: collector → Tempo,
 *   browsable in Grafana). The endpoint defaults to localhost:4318.
 * - unset/anything else → no exporter (a structural no-op).
 */
export function exporterFromEnv(env: NodeJS.ProcessEnv = process.env): SpanExporter | undefined {
  const kind = (env.OTEL_TRACE_EXPORTER ?? '').toLowerCase();
  if (kind === 'console') return new ConsoleSpanExporter();

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '');
  if (kind === 'otlp' || endpoint) {
    return new OTLPTraceExporter({
      url: endpoint ? `${endpoint}/v1/traces` : DEFAULT_OTLP_TRACES_URL,
    });
  }
  return undefined;
}
