import type { LlmCompletion, LlmContentPart, LlmProvider } from '@helix/llm';
import { runAgent } from '../lib/agent-loop';
import { AgentEvent, InMemoryEventBus } from '../lib/events';

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
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
});

const toolUse = (id: string, name: string, input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id,
  name,
  input,
});

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

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('agent event stream', () => {
  it('emits run/step/model events for a no-tool run', async () => {
    const bus = new InMemoryEventBus();
    await runAgent({
      provider: scriptedProvider([completion([{ type: 'text', text: 'hi' }])]),
      agent: {},
      input: 'go',
      onEvent: bus.emit,
    });

    expect(types(bus.events)).toEqual([
      'agent.run.start',
      'agent.step.start',
      'agent.model.response',
      'agent.step.end',
      'agent.run.end',
    ]);
  });

  it('emits tool start/result events around each tool call', async () => {
    const bus = new InMemoryEventBus();
    await runAgent({
      provider: scriptedProvider([
        completion([toolUse('tu_1', 'search', { q: 1 })], 'tool_use'),
        completion([{ type: 'text', text: 'done' }]),
      ]),
      agent: {},
      input: 'go',
      executors: { search: () => ({ content: 'r' }) },
      onEvent: bus.emit,
    });

    expect(types(bus.events)).toEqual([
      'agent.run.start',
      'agent.step.start', // step 0
      'agent.model.response',
      'agent.tool.start',
      'agent.tool.result',
      'agent.step.end',
      'agent.step.start', // step 1
      'agent.model.response',
      'agent.step.end',
      'agent.run.end',
    ]);

    const toolResult = bus.ofType('agent.tool.result')[0];
    expect(toolResult).toMatchObject({
      index: 0,
      call: { id: 'tu_1', name: 'search' },
      result: { content: 'r' },
    });
  });

  it('run.end carries the stop reason, iterations, and totals', async () => {
    const bus = new InMemoryEventBus();
    await runAgent({
      provider: scriptedProvider([completion([{ type: 'text', text: 'ok' }])]),
      agent: {},
      input: 'go',
      onEvent: bus.emit,
    });

    const [end] = bus.ofType('agent.run.end');
    expect(end).toMatchObject({ stopReason: 'end_turn', iterations: 1 });
    expect(end.totals.tokens).toBe(2);
  });

  it('subscribe receives events and can unsubscribe', () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));

    bus.emit({ type: 'agent.run.start', at: new Date() });
    off();
    bus.emit({ type: 'agent.run.end', stopReason: 'end_turn', iterations: 0, totals: { tokens: 0, costUsd: 0 }, at: new Date() });

    expect(seen).toEqual(['agent.run.start']); // nothing after unsubscribe
    expect(bus.events).toHaveLength(2); // bus still records all
  });

  it('works without an onEvent handler (events optional)', async () => {
    const result = await runAgent({
      provider: scriptedProvider([completion([{ type: 'text', text: 'ok' }])]),
      agent: {},
      input: 'go',
    });
    expect(result.finalText).toBe('ok');
  });
});
