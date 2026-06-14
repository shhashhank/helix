/**
 * Local dev worker (NOT for production). Executes workflow runs started via the
 * orchestrator API so you can watch a run progress end-to-end over the SSE stream.
 *
 * It runs each step through the **agent executor** (`@helix/executor`, HELIX-158):
 * the five pipeline roles are registered on a dispatcher driven by the real
 * `runAgent`. The LLM is **config-driven** — with `ANTHROPIC_API_KEY` set it calls
 * the real model; without one it uses the scripted (offline) provider, so a run
 * still executes (agents finish with canned text). Roles outside the standard
 * pipeline fall back to the simulated executor.
 *
 * The coding/testing agents now run with **real sandbox-backed tools** (HELIX-165): each
 * run gets a `@helix/sandbox` workspace (run-scoped, HELIX-161; reclaimed by an idle-TTL
 * sweep), scaffolded (HELIX-164), with the file-edit + command/test tools bound to it —
 * so with a real key a run actually writes files and runs tests. Still deferred: real
 * `git clone` (offline scaffolds a starter project) and real build/ECR/CDK deployment
 * (stubbed) — wired as their bindings land (DEFERRED.md #1/#4).
 *
 * Run it with a Temporal dev server on :7233:
 *   pnpm dev:worker                      # offline (scripted LLM)
 *   ANTHROPIC_API_KEY=sk-… pnpm dev:worker   # real agent runs
 * Tunables: TEMPORAL_ADDRESS (default localhost:7233), STEP_DELAY_MS (default 1500).
 */
import { runAgent } from '@helix/agent';
import { formatWorkspaceDiff } from '@helix/coding-agent';
import {
  DefaultAgentSpecResolver,
  type DeploymentRunner,
  RunScopedWorkspaceProvider,
  type StepExecutor,
  buildPipelineDispatcher,
  simulatedStepExecutor,
} from '@helix/executor';
import { providerFromEnv } from '@helix/llm';
import { NativeConnection } from '@temporalio/worker';
import type { WorkflowRunContext } from './lib/runner';
import { createSandboxWorkspace } from './lib/sandbox-workspace';
import { createWorkflowWorker } from './lib/temporal/worker';
import { HELIX_TASK_QUEUE } from './lib/temporal/shared';

const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? 1500);
/** Dispose a run's workspace after this long with no step touching it (HELIX-161). */
const WORKSPACE_IDLE_MS = Number(process.env.WORKSPACE_IDLE_MS ?? 10 * 60 * 1000);
/** How often to sweep for idle workspaces. */
const WORKSPACE_SWEEP_MS = Number(process.env.WORKSPACE_SWEEP_MS ?? 60 * 1000);

/**
 * Sandbox-backed workspaces + tools (HELIX-165): each run gets a real `@helix/sandbox`
 * workspace, scaffolded/checked-out (HELIX-164), with the coding file-edit tools and the
 * testing command/test tools bound to it. Wrapped in a {@link RunScopedWorkspaceProvider}
 * so a run's steps share one sandbox (coding's files reach testing, HELIX-161); the change
 * set is logged when the workspace is disposed. Real `git clone` stays deferred (DEFERRED.md #1).
 */
const { factory: workspaceFactory, tools } = createSandboxWorkspace({
  onChangeSet: (id, diff) => console.log(`[worker] change set for ${id}:\n${formatWorkspaceDiff(diff)}`),
});
const workspaces = new RunScopedWorkspaceProvider(workspaceFactory);

/** Stub deployment — real build/ECR/CDK against AWS is deferred (DEFERRED.md #4). */
const deployRunner: DeploymentRunner = {
  async deploy() {
    return { ok: true, liveUrl: 'https://deploy.stub.local', environment: 'dev' };
  },
};

async function bootstrap(): Promise<void> {
  const { provider, mode } = providerFromEnv();
  console.log(`[worker] LLM provider: ${mode}${mode === 'scripted' ? ' — set ANTHROPIC_API_KEY for real agent runs' : ''}`);

  const dispatcher = buildPipelineDispatcher({
    provider,
    resolver: new DefaultAgentSpecResolver(),
    runAgent,
    workspaces,
    tools,
    runner: deployRunner,
    context: {},
    fallback: simulatedStepExecutor({ delayMs: STEP_DELAY_MS }),
  });

  // Log each step as it runs.
  const execute: StepExecutor<WorkflowRunContext> = async (step, ctx) => {
    console.log(`[worker] ▶ step "${step.id}" (role: ${step.agentRole})`);
    const result = await dispatcher.run(step, ctx);
    console.log(`[worker] ${result.status === 'success' ? '✓' : '✗'} step "${step.id}" — ${result.status}`);
    return result;
  };

  // Idle-TTL cleanup: dispose run workspaces no step has touched recently. This is the
  // single-worker disposal policy (HELIX-161) — there's no run-end signal here, so a
  // run's workspace lives until it's been idle past the TTL. unref so it can't keep the
  // process alive on its own.
  const sweep = setInterval(() => {
    void workspaces.sweepIdle(WORKSPACE_IDLE_MS).catch((err) => console.error('[worker] workspace sweep failed:', err));
  }, WORKSPACE_SWEEP_MS);
  sweep.unref?.();

  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  console.log(`[worker] connecting to Temporal at ${address} …`);
  const connection = await NativeConnection.connect({ address });
  const worker = await createWorkflowWorker({ connection, taskQueue: HELIX_TASK_QUEUE, execute });
  console.log(`[worker] polling task queue "${HELIX_TASK_QUEUE}" — Ctrl-C to stop`);

  const stop = async () => {
    console.log('\n[worker] shutting down …');
    clearInterval(sweep);
    await workspaces.releaseAll().catch(() => undefined);
    worker.shutdown();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await worker.run();
  await connection.close();
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}
