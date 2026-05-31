import { WorkflowDefinition } from './types';
import { assertValidWorkflow } from './validator';

/**
 * A compiled execution plan (HELIX-69): the workflow's steps grouped into
 * topological **levels**. Every step in a level depends only on steps in earlier
 * levels, so a level's steps can run in parallel and levels run in order.
 */
export interface ExecutionPlan {
  levels: string[][];
}

/**
 * Compile a validated workflow into an {@link ExecutionPlan} via Kahn's
 * algorithm (level-by-level). Validates first (throws `WorkflowValidationFailed`
 * on a malformed/cyclic definition), so the result is always a sound DAG layering.
 * Ids within a level are sorted for deterministic output.
 */
export function compileWorkflow(def: WorkflowDefinition): ExecutionPlan {
  assertValidWorkflow(def);

  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const step of def.steps) {
    indegree.set(step.id, 0);
    children.set(step.id, []);
  }
  for (const edge of def.edges) {
    children.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let frontier = def.steps
    .map((s) => s.id)
    .filter((id) => indegree.get(id) === 0)
    .sort();

  while (frontier.length > 0) {
    levels.push(frontier);
    const next = new Set<string>();
    for (const id of frontier) {
      for (const child of children.get(id)!) {
        indegree.set(child, indegree.get(child)! - 1);
        if (indegree.get(child) === 0) next.add(child);
      }
    }
    frontier = [...next].sort();
  }

  return { levels };
}
