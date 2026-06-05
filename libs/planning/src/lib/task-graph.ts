/**
 * Task dependency ordering + validation (HELIX-97).
 *
 * Takes the tasks from HELIX-96 (each with declared `dependsOn` edges) and turns
 * them into a usable plan: it validates the graph (no duplicate ids, no edges to
 * non-existent tasks, no self-edges, no cycles) and produces a **topological
 * order** plus **dependency "waves"** — groups of tasks with all prerequisites
 * already done, i.e. tasks that can run in parallel. Pure graph work, no LLM.
 */
import { ImplementationTask } from './task-plan';

export type TaskGraphIssueType =
  | 'duplicate-id'
  | 'unknown-dependency'
  | 'self-dependency'
  | 'cycle';

export interface TaskGraphIssue {
  type: TaskGraphIssueType;
  /** The task the issue is about (where applicable). */
  taskId?: string;
  detail: string;
}

export class TaskGraphError extends Error {
  constructor(public readonly issues: TaskGraphIssue[]) {
    super(`Invalid task graph: ${issues.map((i) => i.detail).join('; ')}`);
    this.name = 'TaskGraphError';
  }
}

/**
 * Structural validation (not cycles): duplicate ids, dependencies on tasks that
 * don't exist, and self-dependencies. Returns the issues found (empty = clean).
 */
export function validateTaskGraph(tasks: ImplementationTask[]): TaskGraphIssue[] {
  const issues: TaskGraphIssue[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) {
      issues.push({ type: 'duplicate-id', taskId: t.id, detail: `duplicate task id "${t.id}"` });
    }
    seen.add(t.id);
    ids.add(t.id);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (dep === t.id) {
        issues.push({
          type: 'self-dependency',
          taskId: t.id,
          detail: `task "${t.id}" depends on itself`,
        });
      } else if (!ids.has(dep)) {
        issues.push({
          type: 'unknown-dependency',
          taskId: t.id,
          detail: `task "${t.id}" depends on unknown task "${dep}"`,
        });
      }
    }
  }
  return issues;
}

/**
 * Find dependency cycles via DFS. Returns each detected cycle as an ordered list
 * of task ids (the loop), e.g. `[['T-1','T-2','T-1']]`. Empty if acyclic. Edges
 * to unknown tasks are ignored here (those are reported by {@link validateTaskGraph}).
 */
export function findCycles(tasks: ImplementationTask[]): string[][] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(tasks.map((t) => [t.id, WHITE]));
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue; // unknown dep — handled elsewhere
      const c = color.get(dep);
      if (c === GRAY) {
        // back-edge: extract the loop from `dep` down the stack, closing it.
        const from = stack.indexOf(dep);
        const cycle = [...stack.slice(from), dep];
        const key = canonicalCycle(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (c === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const t of tasks) if (color.get(t.id) === WHITE) visit(t.id);
  return cycles;
}

export interface OrderedTaskGraph {
  /** Topologically sorted tasks: every task comes after its dependencies. */
  order: ImplementationTask[];
  /** Tasks grouped into dependency waves; each wave can run in parallel. */
  waves: ImplementationTask[][];
}

/**
 * Validate the graph and compute a topological order + parallelizable waves.
 * @throws {@link TaskGraphError} on duplicate ids, unknown/self dependencies, or cycles.
 */
export function orderTaskGraph(tasks: ImplementationTask[]): OrderedTaskGraph {
  const issues = validateTaskGraph(tasks);
  for (const cycle of findCycles(tasks)) {
    issues.push({ type: 'cycle', detail: `dependency cycle: ${cycle.join(' → ')}` });
  }
  if (issues.length > 0) throw new TaskGraphError(issues);

  const placed = new Set<string>();
  const waves: ImplementationTask[][] = [];
  while (placed.size < tasks.length) {
    // Tasks (in input order, for determinism) whose every dependency is already placed.
    const wave = tasks.filter(
      (t) => !placed.has(t.id) && t.dependsOn.every((d) => placed.has(d)),
    );
    // Post-validation this is always non-empty; guard defensively.
    if (wave.length === 0) break;
    waves.push(wave);
    for (const t of wave) placed.add(t.id);
  }

  return { order: waves.flat(), waves };
}

function canonicalCycle(cycle: string[]): string {
  // Drop the repeated closing node, then rotate so the smallest id leads — so the
  // same loop discovered from different entry points dedupes to one key.
  const nodes = cycle.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  return [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)].join('>');
}
