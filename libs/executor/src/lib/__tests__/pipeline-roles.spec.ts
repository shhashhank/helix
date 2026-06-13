import type { AgentRunResult, RunAgentOptions } from '@helix/agent';
import type { LlmProvider } from '@helix/llm';
import { DefaultAgentSpecResolver } from '../agent-spec';
import { type ExecutableStep, RoleDispatcher } from '../executor';
import type { RunContext } from '../role-executor';
import { planningInput, registerLlmRoles, reviewInput } from '../pipeline-roles';

const provider = { complete: jest.fn() } as unknown as LlmProvider;
const resolver = new DefaultAgentSpecResolver();
const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 's', agentRole: 'planning', ...over });
const ctx = (results: RunContext['results'] = {}): RunContext => ({ results });
const agentResult = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  finalText: 'ok',
  finalContent: [],
  messages: [],
  steps: [],
  iterations: 1,
  stopReason: 'end_turn',
  totals: { tokens: 0, costUsd: 0 },
  ...over,
});

describe('planningInput', () => {
  it('frames the request as a plan, from config.prompt or config.request', () => {
    expect(planningInput(step({ config: { prompt: 'build a todo app' } }), ctx())).toContain('implementation plan');
    expect(planningInput(step({ config: { prompt: 'build a todo app' } }), ctx())).toContain('build a todo app');
    expect(planningInput(step({ config: { request: 'a CRM' } }), ctx())).toContain('a CRM');
    expect(planningInput(step(), ctx())).toContain('(no request text provided)');
  });
});

describe('reviewInput', () => {
  it('frames a review and includes prior step changes', () => {
    const input = reviewInput(step({ agentRole: 'code_review' }), ctx({ code: { status: 'success', output: 'diff: +api' } }));
    expect(input).toMatch(/Review the changes/);
    expect(input).toContain('- code: diff: +api');
  });
});

describe('registerLlmRoles', () => {
  it('registers planning + code_review and runs them via their specs and framed input', async () => {
    const runAgent = jest.fn(async (_opts: RunAgentOptions) => agentResult({ finalText: 'a plan' }));
    const dispatcher = new RoleDispatcher<RunContext>();
    registerLlmRoles(dispatcher, { provider, resolver, runAgent });

    expect(dispatcher.has('planning')).toBe(true);
    expect(dispatcher.has('code_review')).toBe(true);

    const result = await dispatcher.run(step({ agentRole: 'planning', config: { prompt: 'build X' } }), ctx());
    expect(result).toEqual({ status: 'success', output: 'a plan' });
    const opts = runAgent.mock.calls[0][0];
    expect(opts.agent.system).toMatch(/Planning agent/);
    expect(opts.input).toContain('build X');
    expect(opts.context?.agentRole).toBe('planning');
  });

  it('review runs with the review spec and sees prior code via context', async () => {
    const runAgent = jest.fn(async (_opts: RunAgentOptions) => agentResult());
    const dispatcher = registerLlmRoles(new RoleDispatcher<RunContext>(), { provider, resolver, runAgent });

    await dispatcher.run(step({ agentRole: 'code_review' }), ctx({ code: { status: 'success', output: 'the diff' } }));
    const opts = runAgent.mock.calls[0][0];
    expect(opts.agent.system).toMatch(/Code Review agent/);
    expect(opts.input).toContain('the diff');
  });
});
