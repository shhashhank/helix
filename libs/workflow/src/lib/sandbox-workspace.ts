/**
 * Sandbox-backed workspace wiring for the worker (HELIX-165).
 *
 * This is the worker-side pair that fills the executor's two workspace seams with the
 * real pieces built across the Sandbox Tools epic:
 *  - a {@link WorkspaceFactory} that provisions a `@helix/sandbox` {@link Sandbox} per run,
 *    populates it (scaffold or checkout, HELIX-164), and tears it down — capturing the
 *    run's change set (the PR artifact) on the way out;
 *  - a {@link WorkspaceTools} that hands the **coding** role the sandbox-bound file-edit
 *    tools (HELIX-162) and the **testing** role the command/test tools (HELIX-163).
 *
 * The executor's minimal `Workspace` ({ id, dir }) is bridged to the richer `Sandbox` via
 * a shared registry keyed by the sandbox id; both halves read the same registry. The
 * factory is wrapped in the executor's `RunScopedWorkspaceProvider`, so a run's steps
 * share one sandbox (coding's files reach testing) — see HELIX-161.
 *
 * Real `git clone` (checkout from GitHub) and real deployment stay deferred (DEFERRED #1/#4);
 * offline this scaffolds a starter project and runs everything against local sandboxes.
 */
import type { ExecutableStep, Workspace, WorkspaceFactory, WorkspaceTools } from '@helix/executor';
import {
  type PopulateSpec,
  type ScaffoldFile,
  type WorkspaceDiff,
  type WorkspaceSnapshot,
  captureWorkspaceDiff,
  codingFileEditTools,
  populateWorkspace,
  snapshotWorkspace,
} from '@helix/coding-agent';
import { LocalSandboxProvider, type Sandbox, type SandboxProvider } from '@helix/sandbox';
import { testingTools } from '@helix/testing-agent';
import type { RunChangeSet } from './delivery-runner';

/** A minimal starter project so a brand-new build has a base + a detectable test setup. */
const DEFAULT_SCAFFOLD: ScaffoldFile[] = [
  {
    path: 'package.json',
    content: `${JSON.stringify(
      { name: 'helix-app', version: '0.0.0', private: true, scripts: { test: 'echo "no tests yet" && exit 0' } },
      null,
      2,
    )}\n`,
  },
  { path: 'README.md', content: '# Helix-generated app\n\nScaffolded by the Helix coding agent.\n' },
];

/**
 * Derive how to populate a run's workspace from the step config: an explicit `scaffold`
 * file set if provided, otherwise the {@link DEFAULT_SCAFFOLD}. Repo checkout needs a real
 * fetcher (deferred), so the worker defaults to scaffold (HELIX-164 open decision).
 */
export function populateSpecFromConfig(step: ExecutableStep): PopulateSpec {
  const scaffold = step.config?.['scaffold'];
  const files = Array.isArray(scaffold) ? (scaffold as ScaffoldFile[]) : DEFAULT_SCAFFOLD;
  return { kind: 'scaffold', files, overwrite: true };
}

export interface SandboxWorkspaceDeps {
  /** Sandbox provider (default: a {@link LocalSandboxProvider} — temp-dir workspaces). */
  sandboxes?: SandboxProvider;
  /** How to populate each run's workspace (default: {@link populateSpecFromConfig}). */
  populateSpec?: (step: ExecutableStep) => PopulateSpec;
  /** Called with a run's change set when its workspace is disposed (the PR artifact). */
  onChangeSet?: (workspaceId: string, diff: WorkspaceDiff) => void;
}

/** The filled executor seams, sharing one sandbox registry. */
export interface SandboxWorkspace {
  factory: WorkspaceFactory;
  tools: WorkspaceTools;
  /** A run's changed files (add/update) + summary, for the delivery step (HELIX-186). */
  captureChangeSet(workspaceId: string): Promise<RunChangeSet | undefined>;
}

interface RegistryEntry {
  sandbox: Sandbox;
  /** Snapshot taken right after populating — the change set diffs against this. */
  baseline: WorkspaceSnapshot;
}

/**
 * Build the sandbox-backed {@link WorkspaceFactory} + {@link WorkspaceTools} pair. Wrap the
 * factory in `RunScopedWorkspaceProvider` to get per-run reuse; pass the tools to the
 * pipeline dispatcher.
 */
export function createSandboxWorkspace(deps: SandboxWorkspaceDeps = {}): SandboxWorkspace {
  const sandboxes = deps.sandboxes ?? new LocalSandboxProvider();
  const specOf = deps.populateSpec ?? populateSpecFromConfig;
  const registry = new Map<string, RegistryEntry>();

  const factory: WorkspaceFactory = {
    async create(step: ExecutableStep): Promise<Workspace> {
      const sandbox = await sandboxes.provision({ label: step.id });
      const populated = await populateWorkspace(sandbox, specOf(step));
      registry.set(sandbox.id, { sandbox, baseline: populated.baseline });
      return { id: sandbox.id, dir: sandbox.rootDir };
    },
    async destroy(workspace: Workspace): Promise<void> {
      const entry = registry.get(workspace.id);
      if (!entry) return;
      registry.delete(workspace.id);
      if (deps.onChangeSet) {
        try {
          deps.onChangeSet(workspace.id, await captureWorkspaceDiff(entry.sandbox, entry.baseline));
        } catch {
          // best-effort artifact capture — never block disposal
        }
      }
      await entry.sandbox.dispose();
    },
  };

  const tools: WorkspaceTools = {
    toolsFor(role: string, workspace: Workspace) {
      const entry = registry.get(workspace.id);
      if (!entry) return {};
      if (role === 'coding') return codingFileEditTools(entry.sandbox);
      if (role === 'testing') return testingTools(entry.sandbox);
      return {};
    },
  };

  /** Capture the run's change set as committable files (add/update) + a summary. */
  async function captureChangeSet(workspaceId: string): Promise<RunChangeSet | undefined> {
    const entry = registry.get(workspaceId);
    if (!entry) return undefined;
    const diff = await captureWorkspaceDiff(entry.sandbox, entry.baseline);
    const after = await snapshotWorkspace(entry.sandbox);
    const files = diff.changes
      .filter((change) => change.status !== 'deleted')
      .map((change) => ({ path: change.path, content: after[change.path] ?? '' }));
    return {
      files,
      summary: {
        filesChanged: diff.summary.added + diff.summary.modified + diff.summary.deleted,
        additions: diff.summary.additions,
        deletions: diff.summary.deletions,
      },
    };
  }

  return { factory, tools, captureChangeSet };
}
