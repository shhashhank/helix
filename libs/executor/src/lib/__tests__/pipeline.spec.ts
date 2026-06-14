import type { AgentRunResult, RunAgentOptions } from '@helix/agent';
import type { LlmProvider } from '@helix/llm';
import { DefaultAgentSpecResolver } from '../agent-spec';
import type { DeploymentRunner } from '../deployment-role';
import type { ExecutableStep } from '../executor';
import type { RunContext } from '../role-executor';
import { buildPipelineDispatcher } from '../pipeline';
import type { Workspace, WorkspaceProvider, WorkspaceTools } from '../workspace-roles';

const provider = { complete: jest.fn() } as unknown as LlmProvider;
const runAgent = jest.fn(async (_o: RunAgentOptions): Promise<AgentRunResult> => ({
  finalText: 'ok',
  finalContent: [],
  messages: [],
  steps: [],
  iterations: 1,
  stopReason: 'end_turn',
  totals: { tokens: 0, costUsd: 0 },
}));
const workspaces: WorkspaceProvider = {
  acquire: async (_runId: string, _s: ExecutableStep) => ({ id: 'w', dir: '/tmp/w' }) as Workspace,
  release: async (_runId: string) => undefined,
};
const tools: WorkspaceTools = { toolsFor: () => ({}) };
const runner: DeploymentRunner = { deploy: async () => ({ ok: true, liveUrl: 'https://live' }) };

describe('buildPipelineDispatcher', () => {
  const deps = { provider, resolver: new DefaultAgentSpecResolver(), runAgent, workspaces, tools, runner };

  it('registers all five standard pipeline roles', () => {
    const d = buildPipelineDispatcher(deps);
    for (const role of ['planning', 'coding', 'code_review', 'testing', 'deployment']) {
      expect(d.has(role)).toBe(true);
    }
  });

  it('registers the delivery role only when a deliveryRunner is provided (HELIX-183)', () => {
    expect(buildPipelineDispatcher(deps).has('delivery')).toBe(false);
    const deliveryRunner = { deliver: jest.fn(async () => ({ delivered: false })) };
    expect(buildPipelineDispatcher({ ...deps, deliveryRunner }).has('delivery')).toBe(true);
  });

  it('routes an unknown role to the fallback when given', async () => {
    const fallback = jest.fn(async () => ({ status: 'success' as const, output: 'fb' }));
    const d = buildPipelineDispatcher({ ...deps, fallback });
    const step: ExecutableStep = { id: 's', agentRole: 'mystery' };
    expect(await d.run(step, { results: {} } as RunContext)).toEqual({ status: 'success', output: 'fb' });
  });

  it('runs a registered role through its executor', async () => {
    const d = buildPipelineDispatcher(deps);
    const result = await d.run({ id: 'plan', agentRole: 'planning', config: { prompt: 'X' } }, { results: {} });
    expect(result.status).toBe('success');
    expect(runAgent).toHaveBeenCalled();
  });
});
