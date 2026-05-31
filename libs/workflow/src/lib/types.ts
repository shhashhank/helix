/**
 * Workflow definition DSL (HELIX-68): a workflow is a directed acyclic graph of
 * steps connected by edges. Each step runs an agent (by role); each edge says
 * "after step A finishes with this outcome, run step B". The {@link validateWorkflow}
 * function checks a definition is well-formed before it's compiled/run (HELIX-69).
 */

/** Which prior-step outcome lets an edge fire. */
export type EdgeCondition = 'always' | 'success' | 'failure';

export interface WorkflowStep {
  /** Unique within the workflow; referenced by edges. */
  id: string;
  /** Agent role/type this step runs (e.g. `planning`, `coding`, `code_review`). */
  agentRole: string;
  /** Optional human-readable label. */
  name?: string;
  /** Optional static config passed to the step at run time. */
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  /** Source step id. */
  from: string;
  /** Target step id. */
  to: string;
  /** Fire `to` only when `from` ended with this outcome. Default `success`. */
  when?: EdgeCondition;
}

export interface WorkflowDefinition {
  name: string;
  /** Optional caller-facing version (storage versioning is HELIX-70). */
  version?: number;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

/** A single problem found by {@link validateWorkflow}. */
export interface WorkflowValidationError {
  code: WorkflowErrorCode;
  message: string;
  /** The offending step/edge, when applicable. */
  at?: string;
}

export type WorkflowErrorCode =
  | 'EMPTY_NAME'
  | 'NO_STEPS'
  | 'INVALID_STEP_ID'
  | 'DUPLICATE_STEP_ID'
  | 'EMPTY_AGENT_ROLE'
  | 'EDGE_UNKNOWN_FROM'
  | 'EDGE_UNKNOWN_TO'
  | 'SELF_EDGE'
  | 'DUPLICATE_EDGE'
  | 'INVALID_CONDITION'
  | 'NO_ENTRY_STEP'
  | 'CYCLE';

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
}
