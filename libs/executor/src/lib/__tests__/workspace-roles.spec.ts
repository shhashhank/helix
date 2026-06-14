import type { AgentRunResult, RunAgentOptions, ToolExecutor } from '@helix/agent';
import type { LlmProvider } from '@helix/llm';
import { DefaultAgentSpecResolver } from '../agent-spec';
import { type ExecutableStep, RoleDispatcher } from '../executor';
import type { RunContext } from '../role-executor';
import {
  RunScopedWorkspaceProvider,
  type Workspace,
  type WorkspaceFactory,
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
const ctx = (results: RunContext['results'] = {}, runId?: string): RunContext => ({ results, runId });
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
  acquire: jest.fn(async (_runId: string, _step: ExecutableStep) => ({ id: 'ws-1', dir: '/tmp/ws-1' }) as Workspace),
  release: jest.fn(async (_runId: string) => undefined),
});
const editTool = jest.fn() as unknown as ToolExecutor;
const tools: WorkspaceTools = { toolsFor: (_role, _ws) => ({ edit: editTool }) };

describe('workspaceRoleExecutor', () => {
  it('acquires the run-scoped workspace, runs with workspace tools, and maps the result', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult({ finalText: 'coded' }));
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    const s = step();
    const result = await exec(s, ctx({ plan: { status: 'success', output: 'the plan' } }, 'run-7'));

    expect(result).toEqual({ status: 'success', output: 'coded' });
    expect(workspaces.acquire).toHaveBeenCalledWith('run-7', s); // keyed by the run id, not the step
    const opts = runAgent.mock.calls[0][0];
    expect(Object.keys(opts.executors ?? {})).toEqual(['edit']); // workspace-bound tools
    expect(opts.input).toContain('the plan'); // context flow
    expect(workspaces.release).not.toHaveBeenCalled(); // disposal is run-level, never per step
  });

  it('falls back to a per-step key when no run id is threaded', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult());
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    await exec(step({ id: 'code-step' }), ctx()); // ctx has no runId
    expect(workspaces.acquire).toHaveBeenCalledWith('code-step', expect.objectContaining({ id: 'code-step' }));
  });

  it('propagates a thrown run and does not release the run-scoped workspace', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => {
      throw new Error('boom');
    });
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    await expect(exec(step(), ctx({}, 'run-1'))).rejects.toThrow('boom');
    expect(workspaces.release).not.toHaveBeenCalled(); // the run may retry / continue in the same workspace
  });

  it('fails an unknown role before acquiring any workspace', async () => {
    const workspaces = makeWorkspaces();
    const runAgent = jest.fn(async (_o: RunAgentOptions) => agentResult());
    const exec = workspaceRoleExecutor({ provider, resolver, runAgent, workspaces, tools, buildInput: codingInput });

    const result = await exec(step({ agentRole: 'astrologer' }), ctx());
    expect(result.status).toBe('failure');
    expect(workspaces.acquire).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe('RunScopedWorkspaceProvider', () => {
  const makeFactory = (): jest.Mocked<WorkspaceFactory> => {
    let n = 0;
    return {
      create: jest.fn(async (_step: ExecutableStep) => ({ id: `ws-${++n}`, dir: `/tmp/ws-${n}` }) as Workspace),
      destroy: jest.fn(async (_ws: Workspace) => undefined),
    };
  };

  it('provisions once per run and reuses it for later steps', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    const a = await p.acquire('run-1', step({ id: 's1' }));
    const b = await p.acquire('run-1', step({ id: 's2' })); // testing reuses what coding provisioned

    expect(a).toBe(b);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(p.size).toBe(1);
  });

  it('gives different runs different workspaces', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    const a = await p.acquire('run-1', step());
    const b = await p.acquire('run-2', step());

    expect(a).not.toEqual(b);
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(p.size).toBe(2);
  });

  it('release disposes the run workspace; a later acquire re-provisions', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    const first = await p.acquire('run-1', step());
    await p.release('run-1');
    expect(factory.destroy).toHaveBeenCalledWith(first);
    expect(p.size).toBe(0);

    const second = await p.acquire('run-1', step());
    expect(second).not.toEqual(first); // a fresh workspace
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('release is a no-op for an unknown run', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    await expect(p.release('nope')).resolves.toBeUndefined();
    expect(factory.destroy).not.toHaveBeenCalled();
  });

  it('concurrent first-steps in a run share a single provision', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    const [a, b] = await Promise.all([
      p.acquire('run-1', step({ id: 'a' })),
      p.acquire('run-1', step({ id: 'b' })),
    ]);

    expect(a).toBe(b);
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it('sweepIdle releases only runs idle past the TTL', async () => {
    let clock = 1000;
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory, { now: () => clock });

    await p.acquire('old', step()); // lastUsed = 1000
    clock = 5000;
    await p.acquire('fresh', step()); // lastUsed = 5000
    clock = 6000;
    await p.sweepIdle(2000); // cutoff = 4000 → 'old' is idle, 'fresh' is not

    expect(p.size).toBe(1);
    expect(factory.destroy).toHaveBeenCalledTimes(1);
  });

  it('releaseAll disposes every live run', async () => {
    const factory = makeFactory();
    const p = new RunScopedWorkspaceProvider(factory);

    await p.acquire('run-1', step());
    await p.acquire('run-2', step());
    await p.releaseAll();

    expect(factory.destroy).toHaveBeenCalledTimes(2);
    expect(p.size).toBe(0);
  });

  it('a failed provision does not poison the run (a retry re-provisions)', async () => {
    const factory = makeFactory();
    factory.create.mockRejectedValueOnce(new Error('disk full'));
    const p = new RunScopedWorkspaceProvider(factory);

    await expect(p.acquire('run-1', step())).rejects.toThrow('disk full');
    expect(p.size).toBe(0); // un-poisoned

    const ws = await p.acquire('run-1', step()); // retry succeeds
    expect(ws).toBeDefined();
    expect(factory.create).toHaveBeenCalledTimes(2);
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

    await dispatcher.run(step({ agentRole: 'testing' }), ctx({}, 'run-9'));
    expect(runAgent.mock.calls[0][0].agent.system).toMatch(/Testing agent/);
    expect(workspaces.acquire).toHaveBeenCalledWith('run-9', expect.objectContaining({ agentRole: 'testing' }));
  });
});
