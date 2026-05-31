import {
  EdgeCondition,
  WorkflowDefinition,
  WorkflowValidationError,
  WorkflowValidationResult,
} from './types';

const VALID_CONDITIONS: ReadonlySet<EdgeCondition> = new Set(['always', 'success', 'failure']);
const STEP_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Step ids that have no incoming edge — where execution can start. */
export function entrySteps(def: WorkflowDefinition): string[] {
  const hasIncoming = new Set(def.edges.map((e) => e.to));
  return def.steps.map((s) => s.id).filter((id) => !hasIncoming.has(id));
}

/**
 * Find a cycle in the step graph, returned as the id path (e.g. `[a,b,a]`), or
 * `null` if the graph is acyclic. DFS with a recursion stack. Only edges whose
 * endpoints both exist are considered (missing endpoints are reported separately).
 */
export function findCycle(def: WorkflowDefinition): string[] | null {
  const ids = new Set(def.steps.map((s) => s.id));
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of def.edges) {
    if (ids.has(e.from) && ids.has(e.to)) adj.get(e.from)!.push(e.to);
  }

  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=in-stack 2=done
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.get(next)) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };

  for (const id of ids) {
    if (!state.get(id)) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Validate a workflow definition structurally: non-empty name + steps, valid &
 * unique step ids, every step has an agent role, edges reference existing steps,
 * no self-edges or duplicate edges, valid edge conditions, at least one entry
 * step, and the graph is acyclic. Never throws — returns all errors found.
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];
  const add = (code: WorkflowValidationError['code'], message: string, at?: string) =>
    errors.push({ code, message, at });

  if (!def.name || !def.name.trim()) add('EMPTY_NAME', 'workflow name is required');

  if (!def.steps || def.steps.length === 0) {
    add('NO_STEPS', 'workflow must have at least one step');
    return { valid: false, errors };
  }

  const seen = new Set<string>();
  for (const step of def.steps) {
    if (!step.id || !STEP_ID_RE.test(step.id)) {
      add('INVALID_STEP_ID', `step id "${step.id}" must match ${STEP_ID_RE}`, step.id);
      continue;
    }
    if (seen.has(step.id)) add('DUPLICATE_STEP_ID', `duplicate step id "${step.id}"`, step.id);
    seen.add(step.id);
    if (!step.agentRole || !step.agentRole.trim()) {
      add('EMPTY_AGENT_ROLE', `step "${step.id}" is missing an agentRole`, step.id);
    }
  }

  const edgeKeys = new Set<string>();
  for (const edge of def.edges ?? []) {
    const key = `${edge.from}->${edge.to}`;
    if (!seen.has(edge.from)) add('EDGE_UNKNOWN_FROM', `edge from unknown step "${edge.from}"`, key);
    if (!seen.has(edge.to)) add('EDGE_UNKNOWN_TO', `edge to unknown step "${edge.to}"`, key);
    if (edge.from === edge.to) add('SELF_EDGE', `step "${edge.from}" cannot depend on itself`, key);
    if (edgeKeys.has(key)) add('DUPLICATE_EDGE', `duplicate edge ${key}`, key);
    edgeKeys.add(key);
    if (edge.when !== undefined && !VALID_CONDITIONS.has(edge.when)) {
      add('INVALID_CONDITION', `edge ${key} has invalid condition "${edge.when}"`, key);
    }
  }

  if (entrySteps(def).length === 0) {
    add('NO_ENTRY_STEP', 'workflow has no entry step (every step has an incoming edge)');
  }

  const cycle = findCycle(def);
  if (cycle) add('CYCLE', `workflow has a cycle: ${cycle.join(' -> ')}`);

  return { valid: errors.length === 0, errors };
}

/** Thrown by {@link assertValidWorkflow}. */
export class WorkflowValidationFailed extends Error {
  constructor(public readonly errors: WorkflowValidationError[]) {
    super(`invalid workflow: ${errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    this.name = 'WorkflowValidationFailed';
  }
}

/** Validate and throw {@link WorkflowValidationFailed} if invalid. */
export function assertValidWorkflow(def: WorkflowDefinition): void {
  const { valid, errors } = validateWorkflow(def);
  if (!valid) throw new WorkflowValidationFailed(errors);
}
