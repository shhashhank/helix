import { runAgent } from '../lib/agent-loop';
import { InMemoryEventBus } from '../lib/events';
import type { AgentEvent } from '../lib/events';
import { TraceCollector, buildSpans } from '../lib/trace';
import type { LlmCompletion, LlmContentPart, LlmProvider } from '@helix/llm';

const completion = (
  content: LlmContentPart[],
  stopReason: LlmCompletion['stopReason'] = 'end_turn',
): LlmCompletion => ({
  model: 'claude-opus-4-8',
  stopReason,
  content,
  text: content
    .filter((b): b is Extract<LlmContentPart, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join(''),
  usage: { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
});

const toolUse = (id: string, name: string): LlmContentPart => ({ type: 'tool_use', id, name, input: {} });

function scriptedProvider(script: LlmCompletion[]): LlmProvider {
  let i = 0;
  return {
    name: 'fake',
    async complete() {
      return script[Math.min(i++, script.length - 1)];
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('unused');
    },
  };
}

/** Run the loop, collecting the event stream. */
async function eventsFor(provider: LlmProvider, opts: Parameters<typeof runAgent>[0]['executors'] = {}): Promise<AgentEvent[]> {
  const bus = new InMemoryEventBus();
  await runAgent({ provider, agent: {}, input: 'go', executors: opts, onEvent: bus.emit });
  return bus.events;
}

describe('buildSpans', () => {
  it('produces a run → step → model span tree for a no-tool run', async () => {
    const spans = buildSpans(await eventsFor(scriptedProvider([completion([{ type: 'text', text: 'hi' }])])), 'run1');

    const run = spans.find((s) => s.kind === 'run')!;
    const step = spans.find((s) => s.kind === 'step')!;
    const model = spans.find((s) => s.kind === 'model_call')!;

    expect(run).toMatchObject({ id: 'run1:run', kind: 'run', status: 'ok' });
    expect(run.attributes).toMatchObject({ stopReason: 'end_turn', iterations: 1, totalTokens: 8 });
    expect(step.parentId).toBe(run.id);
    expect(model.parentId).toBe(step.id);
    expect(model.attributes).toMatchObject({ model: 'claude-opus-4-8', inputTokens: 5, outputTokens: 3 });
    for (const s of spans) {
      expect(s.endedAt).toBeDefined();
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('captures tool_call spans parented to their step', async () => {
    const spans = buildSpans(
      await eventsFor(
        scriptedProvider([
          completion([toolUse('tu_1', 'search')], 'tool_use'),
          completion([{ type: 'text', text: 'done' }]),
        ]),
        { search: () => ({ content: 'r' }) },
      ),
      'run2',
    );

    const tool = spans.find((s) => s.kind === 'tool_call')!;
    expect(tool).toMatchObject({ name: 'search', parentId: 'run2:step:0', status: 'ok' });
    expect(spans.filter((s) => s.kind === 'step')).toHaveLength(2);
    expect(spans.filter((s) => s.kind === 'model_call')).toHaveLength(2);
  });

  it('marks a tool span as error when the tool failed', async () => {
    const spans = buildSpans(
      await eventsFor(
        scriptedProvider([
          completion([toolUse('tu_1', 'boom')], 'tool_use'),
          completion([{ type: 'text', text: 'ok' }]),
        ]),
        {
          boom: () => {
            throw new Error('nope');
          },
        },
      ),
      'run3',
    );
    const tool = spans.find((s) => s.kind === 'tool_call')!;
    expect(tool.status).toBe('error');
    expect(tool.attributes).toMatchObject({ isError: true });
  });

  it('computes durations from hand-built timestamps', () => {
    const t = (ms: number) => new Date(1_000_000 + ms);
    const events: AgentEvent[] = [
      { type: 'agent.run.start', at: t(0) },
      { type: 'agent.step.start', index: 0, at: t(10) },
      {
        type: 'agent.model.response',
        index: 0,
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        stopReason: 'end_turn',
        at: t(40),
      },
      { type: 'agent.step.end', index: 0, toolCalls: [], at: t(45) },
      { type: 'agent.run.end', stopReason: 'end_turn', iterations: 1, totals: { tokens: 2, costUsd: 0 }, at: t(50) },
    ];
    const spans = buildSpans(events, 'r');
    expect(spans.find((s) => s.kind === 'run')!.durationMs).toBe(50);
    expect(spans.find((s) => s.kind === 'model_call')!.durationMs).toBe(30); // 40 - 10
    expect(spans.find((s) => s.kind === 'step')!.durationMs).toBe(35); // 45 - 10
  });

  it('marks the run span as error when a guardrail breached', () => {
    const events: AgentEvent[] = [
      { type: 'agent.run.start', at: new Date() },
      {
        type: 'agent.run.end',
        stopReason: 'loop_detected',
        iterations: 3,
        totals: { tokens: 0, costUsd: 0 },
        breach: { type: 'loop_detected', signature: 's', repeats: 3 },
        at: new Date(),
      },
    ];
    const run = buildSpans(events, 'r')[0];
    expect(run.status).toBe('error');
    expect(run.attributes).toMatchObject({ breach: 'loop_detected' });
  });
});

describe('TraceCollector', () => {
  it('writes the run trace to the sink on run.end', async () => {
    const written: unknown[] = [];
    const sink = { write: (spans: unknown[]) => { written.push(...spans); } };
    const collector = new TraceCollector(sink, 'run-x');

    const bus = new InMemoryEventBus();
    bus.subscribe(collector.handle);
    await runAgent({
      provider: scriptedProvider([completion([{ type: 'text', text: 'hi' }])]),
      agent: {},
      input: 'go',
      onEvent: bus.emit,
    });

    expect(written.length).toBeGreaterThan(0);
    expect((written as { kind: string }[]).some((s) => s.kind === 'run')).toBe(true);
  });
});
