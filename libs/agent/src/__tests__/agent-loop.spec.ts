import type { LlmCompletion, LlmContentPart, LlmProvider } from '@helix/llm';
import { runAgent } from '../lib/agent-loop';
import { AgentStep, ToolExecutor } from '../lib/types';

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

const text = (t: string): LlmContentPart => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** Provider that returns a scripted sequence of completions, one per call. */
function scriptedProvider(script: LlmCompletion[]): LlmProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    name: 'fake',
    calls,
    async complete(req) {
      calls.push(req);
      return script[Math.min(i++, script.length - 1)];
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('not used');
    },
  } as LlmProvider & { calls: unknown[] };
}

describe('runAgent', () => {
  it('returns immediately when the first turn has no tool calls', async () => {
    const provider = scriptedProvider([completion([text('done')])]);
    const result = await runAgent({ provider, agent: {}, input: 'hi' });

    expect(result.finalText).toBe('done');
    expect(result.stopReason).toBe('end_turn');
    expect(result.iterations).toBe(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('runs a tool then continues to a final answer', async () => {
    const provider = scriptedProvider([
      completion([text('let me search'), toolUse('tu_1', 'search', { q: 'helix' })], 'tool_use'),
      completion([text('found it')]),
    ]);
    const search = jest.fn<ReturnType<ToolExecutor>, [Parameters<ToolExecutor>[0]]>(async () => ({
      content: 'result-data',
    }));

    const result = await runAgent({
      provider,
      agent: { tools: [{ name: 'search', inputSchema: { type: 'object' } }] },
      input: 'find helix',
      executors: { search },
    });

    expect(search).toHaveBeenCalledWith({ id: 'tu_1', name: 'search', input: { q: 'helix' } });
    expect(result.finalText).toBe('found it');
    expect(result.stopReason).toBe('end_turn');
    expect(result.iterations).toBe(2);

    // Transcript carries the tool_result back to the model.
    const toolResultTurn = result.messages.find(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'tool_result'),
    );
    expect(toolResultTurn).toBeDefined();
    expect(result.steps[0].toolResults[0].result).toEqual({ content: 'result-data' });
  });

  it('surfaces a missing executor as an error tool_result and keeps going', async () => {
    const provider = scriptedProvider([
      completion([toolUse('tu_1', 'ghost', {})], 'tool_use'),
      completion([text('ok')]),
    ]);
    const result = await runAgent({ provider, agent: {}, input: 'go' });

    const tr = result.steps[0].toolResults[0].result;
    expect(tr.isError).toBe(true);
    expect(tr.content).toMatch(/no executor registered for tool "ghost"/);
    expect(result.finalText).toBe('ok');
  });

  it('catches an executor that throws and surfaces it as an error result', async () => {
    const provider = scriptedProvider([
      completion([toolUse('tu_1', 'boom', {})], 'tool_use'),
      completion([text('recovered')]),
    ]);
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: {
        boom: () => {
          throw new Error('tool exploded');
        },
      },
    });

    expect(result.steps[0].toolResults[0].result).toEqual({ content: 'tool exploded', isError: true });
    expect(result.finalText).toBe('recovered');
  });

  it('stops at maxIterations when the model never ends its turn', async () => {
    // Always asks for a tool → never a final answer.
    const provider = scriptedProvider([completion([toolUse('tu', 'loop', {})], 'tool_use')]);
    const steps: AgentStep[] = [];
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: { loop: () => ({ content: 'again' }) },
      maxIterations: 3,
      onStep: (s) => steps.push(s),
    });

    expect(result.stopReason).toBe('max_iterations');
    expect(result.iterations).toBe(3);
    expect(result.steps).toHaveLength(3);
    expect(steps).toHaveLength(3); // onStep fired each iteration
  });

  it('forwards agent spec + context to the provider', async () => {
    const provider = scriptedProvider([completion([text('hi')])]);
    await runAgent({
      provider,
      agent: { system: 'You are X', tier: 'haiku', effort: 'low', maxTokens: 200 },
      input: 'hi',
      context: { runId: 'r1', orgId: 'o1' },
    });

    expect(provider.calls[0]).toMatchObject({
      system: 'You are X',
      tier: 'haiku',
      effort: 'low',
      maxTokens: 200,
      context: { runId: 'r1', orgId: 'o1' },
    });
  });

  it('accepts a full message list as input', async () => {
    const provider = scriptedProvider([completion([text('ok')])]);
    const result = await runAgent({
      provider,
      agent: {},
      input: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    });
    expect(result.messages.slice(0, 3).map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });
});
