/**
 * Commit grouping (HELIX-105): turn a flat set of file changes into **logical
 * commits**. By default changes are grouped by their module directory (e.g.
 * everything under `src/note/` lands in one commit, root files in `(root)`), so
 * a generated resource commits together. The key function is pluggable, so a
 * caller that knows which task produced which file can group **per task**
 * instead. Commit *messages* are generated later (HELIX-110).
 */
import { FileChange } from './diff';

export interface CommitGroup {
  /** The grouping key — a module dir by default, or a task id. */
  key: string;
  changes: FileChange[];
  additions: number;
  deletions: number;
}

/** Default key: the first two path segments (`src/note`), or `(root)` for top-level files. */
export function defaultGroupKey(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, 2).join('/');
}

/**
 * Group changes into commits by `groupKey` (default {@link defaultGroupKey}).
 * Groups are returned sorted by key, each with its changes sorted by path and
 * its total add/delete counts.
 */
export function groupChanges(
  changes: FileChange[],
  groupKey: (change: FileChange) => string = (c) => defaultGroupKey(c.path),
): CommitGroup[] {
  const buckets = new Map<string, FileChange[]>();
  for (const change of changes) {
    const key = groupKey(change);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(change);
    else buckets.set(key, [change]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, groupChangeList]) => {
      const sorted = [...groupChangeList].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
      return {
        key,
        changes: sorted,
        additions: sorted.reduce((sum, c) => sum + c.additions, 0),
        deletions: sorted.reduce((sum, c) => sum + c.deletions, 0),
      };
    });
}
