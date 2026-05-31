import type { AgentEvent } from './events';

/**
 * Structured run traces (HELIX-65): the `agent.*` event stream (HELIX-61) is
 * turned into a tree of spans — one `run` span containing `step` spans, each
 * containing the `model_call` and `tool_call` spans it produced — with timing,
 * status, and attributes. A {@link TraceSink} persists/exports them.
 */
export type SpanKind = 'run' | 'step' | 'model_call' | 'tool_call';
export type SpanStatus = 'ok' | 'error';

export interface TraceSpan {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  startedAt: string; // ISO 8601
  endedAt?: string;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}

export interface TraceSink {
  write(spans: TraceSpan[]): Promise<void> | void;
}

/** In-process sink — keeps spans in memory (tests/dev). */
export class InMemoryTraceSink implements TraceSink {
  readonly spans: TraceSpan[] = [];
  write(spans: TraceSpan[]): void {
    this.spans.push(...spans);
  }
}

const iso = (d: Date): string => d.toISOString();
const dur = (start: string, end: string): number =>
  Math.max(0, new Date(end).getTime() - new Date(start).getTime());

/**
 * Reduce a recorded `agent.*` event stream into ordered spans for one run.
 * Deterministic span ids (`<traceId>:…`) make parent/child links and tests
 * stable. Spans are returned run-first, then in the order they completed.
 */
export function buildSpans(events: AgentEvent[], traceId: string): TraceSpan[] {
  const runId = `${traceId}:run`;
  let runSpan: TraceSpan | undefined;
  const stepStart = new Map<number, string>(); // index → ISO start
  const openSteps = new Map<number, TraceSpan>();
  const openTools = new Map<string, TraceSpan>(); // `${index}:${callId}` → span
  const completed: TraceSpan[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'agent.run.start':
        runSpan = {
          id: runId,
          traceId,
          name: 'agent.run',
          kind: 'run',
          startedAt: iso(e.at),
          status: 'ok',
          attributes: {},
        };
        break;

      case 'agent.step.start': {
        const startedAt = iso(e.at);
        stepStart.set(e.index, startedAt);
        openSteps.set(e.index, {
          id: `${traceId}:step:${e.index}`,
          traceId,
          parentId: runId,
          name: `step ${e.index}`,
          kind: 'step',
          startedAt,
          status: 'ok',
          attributes: { index: e.index },
        });
        break;
      }

      case 'agent.model.response': {
        const start = stepStart.get(e.index) ?? iso(e.at);
        const endedAt = iso(e.at);
        completed.push({
          id: `${traceId}:step:${e.index}:model`,
          traceId,
          parentId: `${traceId}:step:${e.index}`,
          name: 'model_call',
          kind: 'model_call',
          startedAt: start,
          endedAt,
          durationMs: dur(start, endedAt),
          status: e.stopReason === 'refusal' ? 'error' : 'ok',
          attributes: {
            model: e.model,
            stopReason: e.stopReason,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
          },
        });
        break;
      }

      case 'agent.tool.start':
        openTools.set(`${e.index}:${e.call.id}`, {
          id: `${traceId}:step:${e.index}:tool:${e.call.id}`,
          traceId,
          parentId: `${traceId}:step:${e.index}`,
          name: e.call.name,
          kind: 'tool_call',
          startedAt: iso(e.at),
          status: 'ok',
          attributes: { tool: e.call.name },
        });
        break;

      case 'agent.tool.result': {
        const key = `${e.index}:${e.call.id}`;
        const span = openTools.get(key);
        if (span) {
          const endedAt = iso(e.at);
          completed.push({
            ...span,
            endedAt,
            durationMs: dur(span.startedAt, endedAt),
            status: e.result.isError ? 'error' : 'ok',
            attributes: { ...span.attributes, isError: Boolean(e.result.isError) },
          });
          openTools.delete(key);
        }
        break;
      }

      case 'agent.step.end': {
        const span = openSteps.get(e.index);
        if (span) {
          const endedAt = iso(e.at);
          completed.push({ ...span, endedAt, durationMs: dur(span.startedAt, endedAt) });
          openSteps.delete(e.index);
        }
        break;
      }

      case 'agent.run.end':
        if (runSpan) {
          const endedAt = iso(e.at);
          runSpan = {
            ...runSpan,
            endedAt,
            durationMs: dur(runSpan.startedAt, endedAt),
            status: e.breach ? 'error' : 'ok',
            attributes: {
              stopReason: e.stopReason,
              iterations: e.iterations,
              totalTokens: e.totals.tokens,
              totalCostUsd: e.totals.costUsd,
              ...(e.breach ? { breach: e.breach.type } : {}),
            },
          };
        }
        break;
    }
  }

  return runSpan ? [runSpan, ...completed] : completed;
}

/**
 * Stateful trace writer: wire `collector.handle` as `runAgent`'s `onEvent`. It
 * buffers the event stream and, on `agent.run.end`, builds the spans and writes
 * them to the sink in one batch.
 */
export class TraceCollector {
  private events: AgentEvent[] = [];

  constructor(
    private readonly sink: TraceSink,
    private readonly traceId: string,
  ) {}

  handle = (event: AgentEvent): void => {
    this.events.push(event);
    if (event.type === 'agent.run.end') {
      void this.sink.write(buildSpans(this.events, this.traceId));
      this.events = [];
    }
  };
}
