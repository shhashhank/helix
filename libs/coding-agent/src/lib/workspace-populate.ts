/**
 * Populate a run's workspace + capture its change set (HELIX-164).
 *
 * Before the coding agent edits anything, the workspace needs *content*. Two modes,
 * chosen by the caller (the worker derives it from the step config, HELIX-165):
 *  - **scaffold** — write a generated file set for a brand-new project ({@link applyScaffold}).
 *  - **checkout** — materialize an existing repo via a {@link RepoFetcher}
 *    ({@link checkoutRepo}); offline tests/composition use {@link InMemoryRepoFetcher},
 *    real `git clone` stays behind the GitHub binding (DEFERRED #1).
 *
 * Either way we take a **baseline snapshot** right after populating, so once the agent has
 * done its work {@link captureWorkspaceDiff} can diff against it to produce the run's
 * **change set** — the PR artifact (files added/modified/deleted with line-level diffs).
 */
import type { RepoFetcher, RepoRef, Sandbox } from '@helix/sandbox';
import { checkoutRepo } from '@helix/sandbox';
import {
  type FileChange,
  type ListWorkspaceOptions,
  type WorkspaceSnapshot,
  diffSnapshots,
  snapshotWorkspace,
} from './diff';
import { type ScaffoldFile, applyScaffold } from './scaffold';

/** How to populate a fresh workspace — scaffold a new project, or check out a repo. */
export type PopulateSpec =
  | { kind: 'scaffold'; files: ScaffoldFile[]; baseDir?: string; overwrite?: boolean }
  | { kind: 'checkout'; repo: RepoRef; fetcher: RepoFetcher; mountDir?: string };

export interface PopulatedWorkspace {
  kind: PopulateSpec['kind'];
  /** Workspace-relative paths written while populating. */
  files: string[];
  /** Snapshot taken right after populating — the baseline {@link captureWorkspaceDiff} diffs against. */
  baseline: WorkspaceSnapshot;
}

/**
 * Populate `sandbox` per `spec` and return what was written plus a baseline snapshot.
 * Scaffolding a path that already exists throws `ScaffoldConflictError` (unless
 * `overwrite`); a checkout/scaffold path that escapes the workspace throws `SandboxPathError`.
 */
export async function populateWorkspace(sandbox: Sandbox, spec: PopulateSpec): Promise<PopulatedWorkspace> {
  if (spec.kind === 'checkout') {
    const checkout = await checkoutRepo(sandbox, spec.repo, spec.fetcher, { mountDir: spec.mountDir });
    return { kind: 'checkout', files: checkout.files, baseline: await snapshotWorkspace(sandbox) };
  }
  const { written } = await applyScaffold(sandbox, spec.files, { baseDir: spec.baseDir, overwrite: spec.overwrite });
  return { kind: 'scaffold', files: written, baseline: await snapshotWorkspace(sandbox) };
}

/** Roll-up counts for a {@link WorkspaceDiff}. */
export interface WorkspaceDiffSummary {
  added: number;
  modified: number;
  deleted: number;
  additions: number;
  deletions: number;
}

/** The run's change set: per-file changes plus a summary — the PR artifact. */
export interface WorkspaceDiff {
  changes: FileChange[];
  summary: WorkspaceDiffSummary;
}

/**
 * Snapshot the workspace now and diff it against `baseline` (from {@link populateWorkspace})
 * to produce the run's change set. Ignored dirs (`node_modules`, `.git`, `dist`,
 * `coverage`) are excluded by the snapshot, so the diff reflects real source changes only.
 */
export async function captureWorkspaceDiff(
  sandbox: Sandbox,
  baseline: WorkspaceSnapshot,
  options: ListWorkspaceOptions = {},
): Promise<WorkspaceDiff> {
  const after = await snapshotWorkspace(sandbox, options);
  const changes = diffSnapshots(baseline, after);
  const summary = changes.reduce<WorkspaceDiffSummary>(
    (s, c) => {
      if (c.status === 'added') s.added += 1;
      else if (c.status === 'modified') s.modified += 1;
      else s.deleted += 1;
      s.additions += c.additions;
      s.deletions += c.deletions;
      return s;
    },
    { added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 },
  );
  return { changes, summary };
}

/** Render a {@link WorkspaceDiff} as a compact markdown summary for the PR / run UI. */
export function formatWorkspaceDiff(diff: WorkspaceDiff): string {
  if (diff.changes.length === 0) return 'No file changes.';
  const { summary, changes } = diff;
  const header =
    `**${changes.length} file${changes.length === 1 ? '' : 's'} changed** ` +
    `(+${summary.additions} −${summary.deletions}) — ` +
    `${summary.added} added, ${summary.modified} modified, ${summary.deleted} deleted`;
  const mark = (s: FileChange['status']): string => (s === 'added' ? 'A' : s === 'deleted' ? 'D' : 'M');
  return [header, '', ...changes.map((c) => `- \`${mark(c.status)}\` ${c.path} (+${c.additions} −${c.deletions})`)].join('\n');
}
