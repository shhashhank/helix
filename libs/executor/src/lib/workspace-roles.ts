import type { ToolExecutor } from '@helix/agent';
import type { LlmCallContext, LlmMessage, LlmProvider } from '@helix/llm';
import type { AgentSpecResolver } from './agent-spec';
import type { ExecutableStep, RoleDispatcher, StepExecutor } from './executor';
import { type AgentRunner, type RunContext, mapResult, withPriorContext } from './role-executor';

/**
 * The sandbox-backed pipeline roles (HELIX-156): **coding** and **testing**. Unlike
 * the LLM-only roles, these need a workspace — so the executor **acquires** one,
 * runs the agent with **workspace-bound tools** (file edits, test runs), and maps the
 * result. The sandbox + tools are injected seams ({@link WorkspaceProvider} /
 * {@link WorkspaceTools}); the real `@helix/sandbox` + file/test tools are wired in at
 * the worker (HELIX-158/165), keeping this lib pure and offline-testable.
 *
 * The workspace is **run-scoped, not per-step** (HELIX-161): every step in a run shares
 * one workspace, so the **testing** step sees the files the **coding** step wrote. The
 * run id (the Temporal workflow id) is threaded in via {@link RunContext.runId}; the
 * provider keys its registry by it (provision-once, reuse). Disposal is **run-level**
 * (run-end / idle TTL), handled by the provider/worker — never per step here.
 */

/** A provisioned working directory, shared across a run's steps. */
export interface Workspace {
  id: string;
  /** Absolute path to the working directory. */
  dir: string;
}

/**
 * Low-level create/destroy of a {@link Workspace} — the real sandbox provisioning,
 * injected at the worker. {@link RunScopedWorkspaceProvider} wraps one of these to add
 * per-run reuse, so this lib needs no sandbox dependency.
 */
export interface WorkspaceFactory {
  create(step: ExecutableStep): Promise<Workspace>;
  destroy(workspace: Workspace): Promise<void>;
}

/**
 * Acquires the workspace for a run (provision-once, then reuse) and releases it. The
 * executor calls {@link acquire} per step with the run id; because it's keyed by run
 * (not step), a run's steps share one workspace. {@link release} is **run-level** — the
 * worker calls it at run-end or via idle cleanup, never the executor per step (HELIX-161).
 */
export interface WorkspaceProvider {
  acquire(runId: string, step: ExecutableStep): Promise<Workspace>;
  release(runId: string): Promise<void>;
}

interface RunScopedEntry {
  /** Held as the in-flight promise so parallel steps in a run share one provision. */
  workspace: Promise<Workspace>;
  lastUsed: number;
}

/** Options for {@link RunScopedWorkspaceProvider}. */
export interface RunScopedWorkspaceProviderOptions {
  /** Clock for idle tracking (default `Date.now`); injectable for deterministic tests. */
  now?: () => number;
}

/**
 * The default {@link WorkspaceProvider}: a registry of run id → workspace over an
 * injected {@link WorkspaceFactory}. The first step in a run provisions; later steps in
 * the same run reuse it (concurrent first-steps share the in-flight provision). Disposal
 * is run-level — {@link release} for an explicit run-end signal, or {@link sweepIdle} for
 * idle-TTL cleanup (the single-worker dev policy; HELIX-161). Multi-worker durability
 * (diff-replay across machines) is deferred.
 */
export class RunScopedWorkspaceProvider implements WorkspaceProvider {
  private readonly byRun = new Map<string, RunScopedEntry>();
  private readonly now: () => number;

  constructor(
    private readonly factory: WorkspaceFactory,
    options: RunScopedWorkspaceProviderOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  acquire(runId: string, step: ExecutableStep): Promise<Workspace> {
    const existing = this.byRun.get(runId);
    if (existing) {
      existing.lastUsed = this.now();
      return existing.workspace;
    }
    const created = this.factory.create(step);
    const entry: RunScopedEntry = { workspace: created, lastUsed: this.now() };
    this.byRun.set(runId, entry);
    // If provisioning fails, un-poison the registry so a later attempt can re-provision;
    // the original rejection still propagates to the caller (we return `created`).
    created.catch(() => {
      if (this.byRun.get(runId) === entry) this.byRun.delete(runId);
    });
    return created;
  }

  async release(runId: string): Promise<void> {
    const entry = this.byRun.get(runId);
    if (!entry) return;
    this.byRun.delete(runId);
    const workspace = await entry.workspace.catch(() => undefined);
    if (workspace) await this.factory.destroy(workspace);
  }

  /** Release every run whose workspace has been idle for at least `maxIdleMs`. */
  async sweepIdle(maxIdleMs: number): Promise<void> {
    const cutoff = this.now() - maxIdleMs;
    const stale = [...this.byRun.entries()].filter(([, e]) => e.lastUsed <= cutoff).map(([id]) => id);
    for (const id of stale) await this.release(id);
  }

  /** Release every live run (e.g. on worker shutdown). */
  async releaseAll(): Promise<void> {
    for (const id of [...this.byRun.keys()]) await this.release(id);
  }

  /** Count of runs holding a live workspace (introspection / tests). */
  get size(): number {
    return this.byRun.size;
  }
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
 * A {@link StepExecutor} that runs a role's agent **inside the run's workspace**:
 * resolve spec → acquire the run-scoped workspace → run with workspace tools → map
 * result. An unknown role fails before any workspace is acquired.
 *
 * The workspace is keyed by the run id ({@link RunContext.runId}), so a run's steps
 * share it (coding's files reach testing). It is **not** disposed here — disposal is
 * run-level (the provider's `release` / idle sweep at the worker), HELIX-161. With no
 * run id (in-process runner), it falls back to a per-step key — degraded, but functional.
 */
export function workspaceRoleExecutor(deps: WorkspaceRoleDeps): StepExecutor<RunContext> {
  return async (step, ctx) => {
    const agent = await deps.resolver.resolve(step.agentRole);
    if (!agent) return { status: 'failure', error: `no agent spec for role "${step.agentRole}"` };

    const runId = ctx.runId ?? step.id; // run-scoped when threaded; per-step fallback otherwise
    const workspace = await deps.workspaces.acquire(runId, step);
    const result = await deps.runAgent({
      provider: deps.provider,
      agent,
      input: deps.buildInput(step, ctx),
      executors: deps.tools.toolsFor(step.agentRole, workspace),
      maxIterations: deps.maxIterations,
      context: { ...deps.context, agentRole: step.agentRole },
    });
    return mapResult(result);
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
