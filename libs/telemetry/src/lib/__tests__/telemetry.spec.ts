import { trace } from '@opentelemetry/api';
import { ConsoleSpanExporter, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { exporterFromEnv, initTelemetry } from '../telemetry';

describe('initTelemetry', () => {
  it('emits spans through the injected exporter, stamped with the service resource', async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = initTelemetry({
      serviceName: 'registry',
      environment: 'test',
      exporter,
      simple: true,
    });

    const span = telemetry.tracer.startSpan('handle-request', { attributes: { 'helix.run': 'run-7' } });
    span.end();

    const finished = exporter.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0].name).toBe('handle-request');
    expect(finished[0].attributes['helix.run']).toBe('run-7');
    expect(finished[0].resource.attributes['service.name']).toBe('registry');
    expect(finished[0].resource.attributes['deployment.environment']).toBe('test');
    await telemetry.shutdown();
  });

  it('batches by default and delivers on forceFlush', async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = initTelemetry({ serviceName: 'orchestrator', exporter });

    telemetry.tracer.startSpan('queued').end();
    expect(exporter.getFinishedSpans()).toHaveLength(0); // still buffered in the batch

    await telemetry.provider.forceFlush();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(['queued']);
    await telemetry.shutdown();
  });

  it('runs as a structural no-op when no exporter is configured', async () => {
    const telemetry = initTelemetry({ serviceName: 'registry', exporter: undefined });
    expect(() => telemetry.tracer.startSpan('unexported').end()).not.toThrow();
    await telemetry.shutdown();
  });

  it('optionally registers the global tracer provider', async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = initTelemetry({ serviceName: 'registry', exporter, simple: true, global: true });

    trace.getTracer('some-lib').startSpan('via-global').end(); // resolved via the global provider
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(['via-global']);

    await telemetry.shutdown();
    trace.disable(); // reset the global for other tests
  });
});

describe('exporterFromEnv', () => {
  it('returns a console exporter only when OTEL_TRACE_EXPORTER=console', () => {
    expect(exporterFromEnv({ OTEL_TRACE_EXPORTER: 'console' })).toBeInstanceOf(ConsoleSpanExporter);
    expect(exporterFromEnv({ OTEL_TRACE_EXPORTER: 'CONSOLE' })).toBeInstanceOf(ConsoleSpanExporter);
    expect(exporterFromEnv({})).toBeUndefined();
    expect(exporterFromEnv({ OTEL_TRACE_EXPORTER: 'otlp' })).toBeUndefined(); // deferred binding
  });
});
