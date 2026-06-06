/**
 * Branch creation + naming (HELIX-109). The coding agent commits its work to a
 * branch named by a consistent convention — **`helix/<run-id>/<slug>`** — so a
 * run's branch is predictable and collision-free.
 *
 * Naming/sanitisation is pure and deterministic (and produces a name that passes
 * `git check-ref-format`); {@link createGitBranch} does the actual `git checkout
 * -b` through the {@link CommandRunner} in the workspace (real and offline-
 * testable against a `git init`-ed sandbox).
 */
import type { CommandRunner } from '@helix/sandbox';

/** Slugify free text into git-ref-safe lowercase words joined by dashes. */
export function slugify(text: string, maxLength = 50): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

export interface BranchNameOptions {
  /** The run id (the `<run-id>` segment). */
  runId: string;
  /** Human description of the work → the `<slug>` segment. */
  description: string;
  /** Leading segment (default `helix`). */
  prefix?: string;
  /** Max length of the slug (default 50). */
  maxSlugLength?: number;
}

/** Build a `helix/<run-id>/<slug>` branch name (always a valid git ref). */
export function branchName(options: BranchNameOptions): string {
  const prefix = sanitizeSegment(options.prefix ?? 'helix');
  const runId = sanitizeSegment(options.runId);
  const slug = slugify(options.description, options.maxSlugLength ?? 50) || 'work';
  return [prefix, runId, slug].filter(Boolean).join('/');
}

function sanitizeSegment(segment: string): string {
  return segment
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.lock$/i, '')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** Validate against the relevant `git check-ref-format` rules. */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name === '@') return false;
  if (/[\s~^:?*[\\]/.test(name)) return false; // whitespace + forbidden chars
  if (/[\x00-\x1f\x7f]/.test(name)) return false; // control chars
  if (name.includes('..') || name.includes('@{')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return false;
  if (name.endsWith('.') || name.endsWith('.lock')) return false;
  return name
    .split('/')
    .every((seg) => seg !== '' && !seg.startsWith('.') && !seg.endsWith('.lock'));
}

export interface CreateBranchOptions {
  /** Working dir relative to the sandbox root. */
  cwd?: string;
  /** Base ref to branch from (default: current HEAD). */
  base?: string;
  timeoutMs?: number;
}

export interface CreateBranchResult {
  ok: boolean;
  branch: string;
  exitCode: number | null;
  stderr: string;
}

/**
 * Create + switch to a branch via `git checkout -b`. Validates the name first
 * (returns an error result without running git if it's invalid).
 */
export async function createGitBranch(
  runner: CommandRunner,
  name: string,
  options: CreateBranchOptions = {},
): Promise<CreateBranchResult> {
  if (!isValidGitBranchName(name)) {
    return { ok: false, branch: name, exitCode: null, stderr: `invalid git branch name: "${name}"` };
  }
  const exec = await runner.run('git', {
    args: ['checkout', '-b', name, ...(options.base ? [options.base] : [])],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });
  return {
    ok: exec.exitCode === 0 && !exec.timedOut,
    branch: name,
    exitCode: exec.exitCode,
    stderr: exec.stderr,
  };
}
