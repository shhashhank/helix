import type { AgentRunResult, RunAgentOptions, ToolExecutor } from '@helix/agent';
import type { LlmProvider } from '@helix/llm';
import { DefaultAgentSpecResolver } from '../agent-spec';
import { type ExecutableStep, RoleDispatcher } from '../executor';
import type { RunContext } from '../role-executor';
import {
  type Workspace,
  type WorkspaceProvider,
  type WorkspaceTools,
  codingInput,
  registerWorkspaceRoles,
  testingInput,
  workspaceRoleExecutor,
} from '../workspace-roles';

const provider = { complete: jest.fn() } as unknown as LlmProvider;
const resolver = new DefaultAgentSpecResolver();
const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 's', agentRole: 'coding', ...over });
const ctx = (results: RunContext['results'] = {}): RunContext => ({ results });
const agentResult = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  finalText: 'built',
  finalContent: [],
  messages: [],
  steps: [],
  iterations: 1,
  stopReason: 'end_turn',
  totals: { tokens: 0, costUsd: 0 },
  ...over,
});

const makeWorkspaces = (): jest.Mocked<WorkspaceProvider> => ({
  provision: jest.fn(async (_step: ExecutableStep) => ({ id: 'ws-1', dir: '/tmp/ws-1' }) as Workspace),
  dispose: jest.fn(async (_ws: Workspace) => undefined),
});
const editTool = jest.fn() as unknown as ToolExecutor;
const tools: WorkspaceTools = { toolsFor: (_role, _ws) => ({ edit: editTool }) };

describe('workspaceRoleExecutor', () => {
  it('provisions a workspace, runs with workspace tools, maps the result, and disposes', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult({ finalText: 'coded' }));
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    const result = await exec(step(), ctx({ plan: { status: 'success', output: 'the plan' } }));

    expect(result).toEqual({ status: 'success', output: 'coded' });
    expect(workspaces.provision).toHaveBeenCalledTimes(1);
    const opts = runAgent.mock.calls[0][0];
    expect(Object.keys(opts.executors ?? {})).toEqual(['edit']); // workspace-bound tools
    expect(opts.input).toContain('the plan'); // context flow
    expect(workspaces.dispose).toHaveBeenCalledWith({ id: 'ws-1', dir: '/tmp/ws-1' });
  });

  it('disposes the workspace even when the run throws (then re-throws)', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => {
      throw new Error('boom');
    });
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    await expect(exec(step(), ctx())).rejects.toThrow('boom');
    expect(workspaces.dispose).toHaveBeenCalledTimes(1);
  });

  it('fails an unknown role before provisioning any workspace', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult());
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    const result = await exec(step({ agentRole: 'astrologer' }), ctx());
    expect(result.status).toBe('failure');
    expect(workspaces.provision).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('a failing dispose does not mask a successful result', async () => {
    const workspaces = makeWorkspaces();
    workspaces.dispose.mockRejectedValue(new Error('dispose failed'));
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult({ finalText: 'ok' }));
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    await expect(exec(step(), ctx())).resolves.toEqual({ status: 'success', output: 'ok' });
  });
});

describe('input framing + registration', () => {
  it('codingInput / testingInput frame the task and include prior context', () => {
    expect(codingInput(step(), ctx({ plan: { status: 'success', output: 'P' } }))).toMatch(/Implement the planned changes/);
    expect(codingInput(step(), ctx({ plan: { status: 'success', output: 'P' } }))).toContain('- plan: P');
    expect(testingInput(step(), ctx())).toMatch(/Generate tests/);
  });

  it('registerWorkspaceRoles registers coding + testing on the dispatcher', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult());
    const dispatcher = registerWorkspaceRoles(new RoleDispatcher<RunContext>(), { provider, resolver, runAgent, workspaces, tools });

    expect(dispatcher.has('coding')).toBe(true);
    expect(dispatcher.has('testing')).toBe(true);

    await dispatcher.run(step({ agentRole: 'testing' }), ctx());
    expect(runAgent.mock.calls[0][0].agent.system).toMatch(/Testing agent/);
    expect(workspaces.provision).toHaveBeenCalledTimes(1);
  });
});
