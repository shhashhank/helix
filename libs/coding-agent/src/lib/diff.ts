/**
 * Workspace diff generation (HELIX-105): figure out what the agent changed.
 *
 * Snapshot the workspace right after checkout, let the agent edit, snapshot again,
 * and {@link diffSnapshots} reports the added / modified / deleted files with a
 * line-level diff and add/delete counts. Pure and deterministic — a real local
 * sandbox is all the tests need; no `git` required (the actual commit is the
 * deferred git binding / HELIX-32).
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sandbox } from '@helix/sandbox';
import { readFile } from './file-edits';

/** Workspace contents as `path → text`. */
export type WorkspaceSnapshot = Record<string, string>;

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'coverage'];

export interface ListWorkspaceOptions {
  /** List under this sandbox-relative dir (default: the root). */
  baseDir?: string;
  /** Directory/file names to skip (default: node_modules, .git, dist, coverage). */
  ignore?: string[];
}

/** Recursively list workspace files (relative paths, sorted), skipping ignores. */
export async function listWorkspaceFiles(
  sandbox: Sandbox,
  options: ListWorkspaceOptions = {},
): Promise<string[]> {
  const baseRel = options.baseDir ?? '.';
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
  const results: string[] = [];

  const walk = async (relDir: string): Promise<void> => {
    const absDir = sandbox.resolve(relDir === '' ? '.' : relDir);
    for (const entry of await readdir(absDir, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile()) results.push(rel);
    }
  };

  await walk(baseRel === '.' ? '' : baseRel);
  return results.sort();
}

/** Read every workspace file into a {@link WorkspaceSnapshot}. */
export async function snapshotWorkspace(
  sandbox: Sandbox,
  options: ListWorkspaceOptions = {},
): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = {};
  for (const path of await listWorkspaceFiles(sandbox, options)) {
    snapshot[path] = await readFile(sandbox, path);
  }
  return snapshot;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  /** Line-level diff (` ` context, `-` removed, `+` added). */
  diff: string;
}

/** Diff two snapshots into the set of file changes (sorted by path). */
export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: FileChange[] = [];
  for (const path of paths) {
    const had = path in before;
    const has = path in after;
    if (had && has) {
      if (before[path] === after[path]) continue;
      changes.push({ path, status: 'modified', ...lineDiff(before[path], after[path]) });
    } else if (has) {
      changes.push({ path, status: 'added', ...lineDiff('', after[path]) });
    } else {
      changes.push({ path, status: 'deleted', ...lineDiff(before[path], '') });
    }
  }
  return changes;
}

export interface LineDiff {
  diff: string;
  additions: number;
  deletions: number;
}

/** Line-level diff via LCS: ` ` context, `-` removed, `+` added. */
export function lineDiff(oldText: string, newText: string): LineDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`-${a[i]}`);
      deletions++;
      i++;
    } else {
      out.push(`+${b[j]}`);
      additions++;
      j++;
    }
  }
  for (; i < n; i++) {
    out.push(`-${a[i]}`);
    deletions++;
  }
  for (; j < m; j++) {
    out.push(`+${b[j]}`);
    additions++;
  }

  return { diff: out.join('\n'), additions, deletions };
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}
