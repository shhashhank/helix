import { compileWorkflow } from './compiler';
import { EdgeCondition, WorkflowDefinition, WorkflowStep } from './types';

export type StepStatus = 'success' | 'failure';

/** What a step runner returns. */
export interface StepRunResult {
  status: StepStatus;
  output?: unknown;
  error?: string;
}

/** Per-step record after the run: whether it ran (vs. was skipped) + its result. */
export interface StepOutcome {
  id: string;
  /** False when the step was skipped because no incoming branch was taken. */
  ran: boolean;
  status?: StepStatus;
  output?: unknown;
  error?: string;
}

export interface WorkflowRunContext {
  /** Results of steps that actually ran, keyed by step id. */
  results: Record<string, StepRunResult>;
  /**
   * The run's id (the Temporal workflow id). Set by the durable runner so a step
   * executor can scope per-run resources (e.g. a shared sandbox workspace, HELIX-161);
   * the in-process runner leaves it undefined.
   */
  runId?: string;
}

/** Executes one workflow step (e.g. by invoking the agent loop). Throwing = failure. */
export type WorkflowStepRunner = (
  step: WorkflowStep,
  ctx: WorkflowRunContext,
) => Promise<StepRunResult> | StepRunResult;

export interface WorkflowRunResult {
  steps: Record<string, StepOutcome>;
  completed: string[];
  skipped: string[];
  levels: string[][];
}

/** A live snapshot of run progress, emitted as steps finish (HELIX-79). */
export interface WorkflowProgress {
  steps: Record<string, StepOutcome>;
  completed: string[];
  skipped: string[];
  levels: string[][];
  /** True once the whole run has finished (set by the caller after {@link runWorkflow} returns). */
  done: boolean;
}

/** Called after each step settles, with a snapshot of progress so far (`done: false`). */
export type ProgressObserver = (progress: WorkflowProgress) => void;

/** An incoming edge's condition is met only if the parent actually ran with a matching outcome. */
function conditionMet(when: EdgeCondition | undefined, parent: StepOutcome | undefined): boolean {
  if (!parent || !parent.ran) return false;
  switch (when ?? 'success') {
    case 'always':
      return true;
    case 'failure':
      return parent.status === 'failure';
    case 'success':
    default:
      return parent.status === 'success';
  }
}

/**
 * Run a workflow (HELIX-69): compile to topological levels, then execute level
 * by level, running each level's steps in parallel. A step runs when it's an
 * entry step or at least one incoming edge's condition is satisfied by its
 * parent's outcome; otherwise it's **skipped** (its branch wasn't taken). A
 * thrown runner becomes a `failure` outcome — so `failure` edges can route to
 * recovery steps. Returns each step's outcome plus completed/skipped lists.
 */
export async function runWorkflow(
  def: WorkflowDefinition,
  runner: WorkflowStepRunner,
  onProgress?: ProgressObserver,
): Promise<WorkflowRunResult> {
  const plan = compileWorkflow(def);
  const stepById = new Map(def.steps.map((s) => [s.id, s]));
  const incoming = new Map<string, { from: string; when?: EdgeCondition }[]>();
  for (const s of def.steps) incoming.set(s.id, []);
  for (const e of def.edges) incoming.get(e.to)!.push({ from: e.from, when: e.when });

  const outcomes: Record<string, StepOutcome> = {};
  const emit = () => {
    if (!onProgress) return;
    const all = Object.values(outcomes);
    onProgress({
      steps: { ...outcomes },
      completed: all.filter((o) => o.ran).map((o) => o.id),
      skipped: all.filter((o) => !o.ran).map((o) => o.id),
      levels: plan.levels,
      done: false,
    });
  };

  for (const level of plan.levels) {
    await Promise.all(
      level.map(async (id) => {
        const inc = incoming.get(id)!;
        const eligible = inc.length === 0 || inc.some((e) => conditionMet(e.when, outcomes[e.from]));
        if (!eligible) {
          outcomes[id] = { id, ran: false };
          emit();
          return;
        }
        const results: Record<string, StepRunResult> = {};
        for (const [k, v] of Object.entries(outcomes)) {
          if (v.ran && v.status) results[k] = { status: v.status, output: v.output, error: v.error };
        }
        try {
          const res = await runner(stepById.get(id)!, { results });
          outcomes[id] = { id, ran: true, status: res.status, output: res.output, error: res.error };
        } catch (err) {
          outcomes[id] = { id, ran: true, status: 'failure', error: err instanceof Error ? err.message : String(err) };
        }
        emit();
      }),
    );
  }

  const all = Object.values(outcomes);
  return {
    steps: outcomes,
    completed: all.filter((o) => o.ran).map((o) => o.id),
    skipped: all.filter((o) => !o.ran).map((o) => o.id),
    levels: plan.levels,
  };
}
