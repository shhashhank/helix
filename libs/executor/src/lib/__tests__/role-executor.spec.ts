import type { AgentRunResult, RunAgentOptions, ToolExecutor } from '@helix/agent';
import type { LlmProvider } from '@helix/llm';
import { DefaultAgentSpecResolver } from '../agent-spec';
import type { ExecutableStep } from '../executor';
import { type RunContext, createRoleExecutor, defaultBuildInput, mapResult } from '../role-executor';

const provider = { complete: jest.fn() } as unknown as LlmProvider;
const resolver = new DefaultAgentSpecResolver();
const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 's1', agentRole: 'coding', ...over });
const ctx = (results: RunContext['results'] = {}): RunContext => ({ results });

/** A finished agent run, overridable per test. */
const agentResult = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  finalText: 'done',
  finalContent: [],
  messages: [],
  steps: [],
  iterations: 1,
  stopReason: 'end_turn',
  totals: { tokens: 0, costUsd: 0 },
  ...over,
});

describe('mapResult', () => {
  it('maps a clean end_turn (no breach) to success, output = validated data when present', () => {
    expect(mapResult(agentResult({ output: { valid: true, data: { ok: 1 }, raw: '{"ok":1}' } }))).toEqual({
      status: 'success',
      output: { ok: 1 },
    });
  });

  it('falls back to finalText when there is no valid structured output', () => {
    expect(mapResult(agentResult({ finalText: 'the plan' }))).toEqual({ status: 'success', output: 'the plan' });
  });

  it('maps a guardrail breach to failure', () => {
    const r = mapResult(agentResult({ breach: { type: 'cost_budget', limit: 1, observed: 2 } }));
    expect(r.status).toBe('failure');
    expect(r.error).toMatch(/guardrail breach: cost_budget/);
  });

  it('maps a non-finishing stop reason (refusal / max_iterations) to failure', () => {
    expect(mapResult(agentResult({ stopReason: 'refusal' })).status).toBe('failure');
    expect(mapResult(agentResult({ stopReason: 'max_iterations' })).error).toMatch(/agent stopped: max_iterations/);
  });
});

describe('defaultBuildInput', () => {
  it('uses config.prompt and appends prior step outputs', () => {
    const input = defaultBuildInput(step({ agentRole: 'coding', config: { prompt: 'build the API' } }), ctx({
      plan: { status: 'success', output: 'a 3-step plan' },
      noise: { status: 'success' }, // no output → omitted
    }));
    expect(input).toContain('build the API');
    expect(input).toContain('Context from prior steps:');
    expect(input).toContain('- plan: a 3-step plan');
    expect(input).not.toContain('noise');
  });

  it('uses a generic instruction when there is no config.prompt and no prior context', () => {
    expect(defaultBuildInput(step({ id: 'plan', agentRole: 'planning' }), ctx())).toBe(
      'Perform the "planning" step (plan).',
    );
  });
});

describe('createRoleExecutor', () => {
  it('resolves the role spec, runs the agent with the built input + role attribution, and maps success', async () => {
    const runAgent = jest.fn(async (_opts: RunAgentOptions) => agentResult({ finalText: 'coded' }));
    const exec = createRoleExecutor({ provider, resolver, runAgent, context: { runId: 'run-1' } });

    const result = await exec(step({ agentRole: 'coding', config: { prompt: 'do it' } }), ctx({ plan: { status: 'success', output: 'P' } }));

    expect(result).toEqual({ status: 'success', output: 'coded' });
    const opts = runAgent.mock.calls[0][0];
    expect(opts.provider).toBe(provider);
    expect(opts.agent.system).toMatch(/Coding agent/);
    expect(opts.context).toEqual({ runId: 'run-1', agentRole: 'coding' });
    expect(opts.input).toContain('do it');
    expect(opts.input).toContain('- plan: P'); // step-to-step context flow
  });

  it('fails the step (without running the agent) when the role has no spec', async () => {
    const runAgent = jest.fn(async (_opts: RunAgentOptions) => agentResult());
    const exec = createRoleExecutor({ provider, resolver, runAgent });

    const result = await exec(step({ agentRole: 'astrologer' }), ctx());
    expect(result.status).toBe('failure');
    expect(result.error).toMatch(/no agent spec for role "astrologer"/);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes role tools through to the agent run', async () => {
    const runAgent = jest.fn(async (_opts: RunAgentOptions) => agentResult());
    const tool = jest.fn() as unknown as ToolExecutor;
    const exec = createRoleExecutor({
      provider,
      resolver,
      runAgent,
      toolsFor: (role): Record<string, ToolExecutor> => (role === 'coding' ? { edit: tool } : {}),
    });

    await exec(step({ agentRole: 'coding' }), ctx());
    expect(Object.keys(runAgent.mock.calls[0][0].executors ?? {})).toEqual(['edit']);
  });
});
