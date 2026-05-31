import type { LlmCompletion, LlmContentPart, LlmProvider, LlmUsage } from '@helix/llm';
import { runAgent } from '../lib/agent-loop';

const usage = (o: Partial<LlmUsage> = {}): LlmUsage => ({
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  ...o,
});

const toolUse = (name: string, input: unknown, id = 'tu'): LlmContentPart => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const completion = (
  content: LlmContentPart[],
  u: LlmUsage = usage(),
  stopReason: LlmCompletion['stopReason'] = 'tool_use',
  model = 'claude-opus-4-8',
): LlmCompletion => ({ model, stopReason, content, text: '', usage: u });

/** Provider that returns the same completion on every call. */
function constantProvider(c: LlmCompletion): LlmProvider {
  return {
    name: 'fake',
    async complete() {
      return c;
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('unused');
    },
  };
}

const noopTool = { content: 'ok' };
const exec = { search: () => noopTool, loop: () => noopTool };

describe('guardrails', () => {
  it('stops at maxSteps', async () => {
    const provider = constantProvider(completion([toolUse('search', { q: 1 })]));
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: exec,
      guardrails: { maxSteps: 2, loopDetection: false },
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.iterations).toBe(2);
    expect(result.steps).toHaveLength(2);
    expect(result.breach).toEqual({ type: 'max_steps', limit: 2, observed: 2 });
  });

  it('stops on the token ceiling', async () => {
    const provider = constantProvider(
      completion([toolUse('search', {})], usage({ inputTokens: 1000, outputTokens: 0 })),
    );
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: exec,
      guardrails: { maxTokens: 500, loopDetection: false },
    });

    expect(result.stopReason).toBe('token_budget');
    expect(result.breach).toMatchObject({ type: 'token_budget', limit: 500 });
    expect(result.totals.tokens).toBe(1000);
  });

  it('stops on the cost ceiling', async () => {
    // opus: 1M input @ $5/M = $5 on the first turn → exceeds $1 ceiling.
    const provider = constantProvider(
      completion([toolUse('search', {})], usage({ inputTokens: 1_000_000, outputTokens: 0 })),
    );
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: exec,
      guardrails: { maxCostUsd: 1.0, loopDetection: false },
    });

    expect(result.stopReason).toBe('cost_budget');
    expect(result.breach).toMatchObject({ type: 'cost_budget', limit: 1.0 });
    expect(result.totals.costUsd).toBeCloseTo(5.0, 6);
  });

  it('detects a repeated-tool-call loop', async () => {
    const provider = constantProvider(completion([toolUse('loop', { same: true })]));
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: exec,
      guardrails: { loopDetection: { windowSize: 2 } },
    });

    expect(result.stopReason).toBe('loop_detected');
    expect(result.iterations).toBe(2);
    expect(result.breach).toMatchObject({ type: 'loop_detected', repeats: 2 });
  });

  it('does not loop-detect when loopDetection is disabled', async () => {
    const provider = constantProvider(completion([toolUse('loop', { same: true })]));
    const result = await runAgent({
      provider,
      agent: {},
      input: 'go',
      executors: exec,
      guardrails: { maxSteps: 4, loopDetection: false },
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.iterations).toBe(4);
  });

  it('reports cumulative totals even with no guardrails', async () => {
    const provider = constantProvider(
      completion([{ type: 'text', text: 'done' }], usage({ inputTokens: 10, outputTokens: 4 }), 'end_turn'),
    );
    const result = await runAgent({ provider, agent: {}, input: 'hi' });

    expect(result.stopReason).toBe('end_turn');
    expect(result.totals.tokens).toBe(14);
    // opus: 10 in @ $5/M + 4 out @ $25/M
    expect(result.totals.costUsd).toBeCloseTo(10 * 5e-6 + 4 * 25e-6, 9);
  });
});
