import type { ToolExecutor } from '@helix/agent';
import type { LlmCallContext, LlmMessage, LlmProvider } from '@helix/llm';
import type { AgentSpecResolver } from './agent-spec';
import type { ExecutableStep, RoleDispatcher, StepExecutor } from './executor';
import { type AgentRunner, type RunContext, mapResult, withPriorContext } from './role-executor';

/**
 * The sandbox-backed pipeline roles (HELIX-156): **coding** and **testing**. Unlike
 * the LLM-only roles, these need a workspace — so the executor **provisions** one,
 * runs the agent with **workspace-bound tools** (file edits, test runs), then
 * **disposes** it. The sandbox + tools are injected seams ({@link WorkspaceProvider}
 * / {@link WorkspaceTools}); the real `@helix/sandbox` + file/test tools are wired in
 * at the worker (HELIX-158), keeping this lib pure and offline-testable.
 */

/** A provisioned working directory for a step. */
export interface Workspace {
  id: string;
  /** Absolute path to the working directory. */
  dir: string;
}

/** Provisions / tears down a {@link Workspace} for a step (the sandbox seam). */
export interface WorkspaceProvider {
  provision(step: ExecutableStep): Promise<Workspace>;
  dispose(workspace: Workspace): Promise<void>;
}

/** Builds the tools an agent gets for a role, bound to its workspace. */
export interface WorkspaceTools {
  toolsFor(role: string, workspace: Workspace): Record<string, ToolExecutor>;
}

export interface WorkspaceRoleDeps {
  provider: LlmProvider;
  resolver: AgentSpecResolver;
  runAgent: AgentRunner;
  workspaces: WorkspaceProvider;
  tools: WorkspaceTools;
  buildInput: (step: ExecutableStep, ctx: RunContext) => string | LlmMessage[];
  context?: Omit<LlmCallContext, 'agentRole'>;
  maxIterations?: number;
}

/**
 * A {@link StepExecutor} that runs a role's agent **inside a provisioned workspace**:
 * resolve spec → provision → run with workspace tools → map result, disposing the
 * workspace afterward (best-effort, even if the run throws). An unknown role fails
 * before any workspace is provisioned.
 */
export function workspaceRoleExecutor(deps: WorkspaceRoleDeps): StepExecutor<RunContext> {
  return async (step, ctx) => {
    const agent = await deps.resolver.resolve(step.agentRole);
    if (!agent) return { status: 'failure', error: `no agent spec for role "${step.agentRole}"` };

    const workspace = await deps.workspaces.provision(step);
    try {
      const result = await deps.runAgent({
        provider: deps.provider,
        agent,
        input: deps.buildInput(step, ctx),
        executors: deps.tools.toolsFor(step.agentRole, workspace),
        maxIterations: deps.maxIterations,
        context: { ...deps.context, agentRole: step.agentRole },
      });
      return mapResult(result);
    } finally {
      await deps.workspaces.dispose(workspace).catch(() => undefined); // best-effort; never masks the result
    }
  };
}

/** Coding input: implement the plan in the workspace. */
export function codingInput(_step: ExecutableStep, ctx: RunContext): string {
  return withPriorContext(
    'Implement the planned changes in the workspace. Use the file tools to read and write files; make ' +
      'the change compile and pass lint, then prepare a commit on a branch.',
    ctx,
  );
}

/** Testing input: generate + run tests for the changes. */
export function testingInput(_step: ExecutableStep, ctx: RunContext): string {
  return withPriorContext(
    'Generate tests for the changes mapped to the acceptance criteria, run them in the workspace, and ' +
      'report results and coverage. Surface failures for fixing.',
    ctx,
  );
}

/** Deps for a workspace role — minus the per-role input builder. */
export type WorkspaceRoleBaseDeps = Omit<WorkspaceRoleDeps, 'buildInput'>;

/** A StepExecutor for the `coding` role. */
export const codingExecutor = (deps: WorkspaceRoleBaseDeps) =>
  workspaceRoleExecutor({ ...deps, buildInput: codingInput });

/** A StepExecutor for the `testing` role. */
export const testingExecutor = (deps: WorkspaceRoleBaseDeps) =>
  workspaceRoleExecutor({ ...deps, buildInput: testingInput });

/** Register the sandbox-backed roles (`coding`, `testing`) on a dispatcher. */
export function registerWorkspaceRoles(
  dispatcher: RoleDispatcher<RunContext>,
  deps: WorkspaceRoleBaseDeps,
): RoleDispatcher<RunContext> {
  dispatcher.register('coding', codingExecutor(deps));
  dispatcher.register('testing', testingExecutor(deps));
  return dispatcher;
}
