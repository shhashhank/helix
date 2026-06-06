/**
 * Self-correction loop (HELIX-108): the driver that ties the build/lint runner
 * (HELIX-106) and error feedback (HELIX-107) into a bounded fix loop.
 *
 *   run checks → pass? done. fail? build feedback → applyFix → re-run …
 *
 * It runs at most `maxIterations` times. The fix step is an injected callback
 * (the agent edits files from the feedback) so the LLM stays out of this lib and
 * the loop is fully offline-testable. When the budget is exhausted with checks
 * still failing it **bails out and signals escalation to a human** (status
 * `exhausted`, `escalate: true`) rather than committing broken code.
 */
import type { CommandRunner } from '@helix/sandbox';
import { CheckCommand, ChecksOutcome, runChecks } from './checks';
import { buildFixFeedback, FixFeedback, FixFeedbackOptions } from './feedback';

/** Apply a fix from the feedback (e.g. the agent edits files). */
export type FixApplier = (feedback: FixFeedback, iteration: number) => Promise<void>;

export interface SelfCorrectOptions {
  checks: CheckCommand[];
  applyFix: FixApplier;
  /** Max number of check runs (default 3, min 1). */
  maxIterations?: number;
  /** Working dir relative to the sandbox root. */
  cwd?: string;
  /** Per-check wall-clock timeout (ms). */
  timeoutMs?: number;
  /** Stop a single checks pass at the first failing check. */
  stopOnFailure?: boolean;
  feedbackOptions?: FixFeedbackOptions;
}

export type SelfCorrectStatus = 'passed' | 'exhausted';

export interface SelfCorrectAttempt {
  iteration: number;
  outcome: ChecksOutcome;
  /** Feedback built from a failing run (absent when the run passed). */
  feedback?: FixFeedback;
}

export interface SelfCorrectResult {
  status: SelfCorrectStatus;
  /** True when the budget ran out with checks still failing — escalate to a human. */
  escalate: boolean;
  /** Number of check runs performed. */
  iterations: number;
  /** Number of times the fix step ran. */
  fixAttempts: number;
  finalOutcome: ChecksOutcome;
  /** Feedback from the final failing run, when exhausted. */
  finalFeedback?: FixFeedback;
  history: SelfCorrectAttempt[];
}

/**
 * Run the self-correction loop. Returns `passed` as soon as the checks pass, or
 * `exhausted` (with `escalate: true`) once `maxIterations` runs have failed.
 */
export async function selfCorrect(
  runner: CommandRunner,
  options: SelfCorrectOptions,
): Promise<SelfCorrectResult> {
  const maxIterations = Math.max(1, options.maxIterations ?? 3);
  const history: SelfCorrectAttempt[] = [];
  let fixAttempts = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const outcome = await runChecks(runner, options.checks, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      stopOnFailure: options.stopOnFailure,
    });

    if (outcome.ok) {
      history.push({ iteration, outcome });
      return {
        status: 'passed',
        escalate: false,
        iterations: iteration,
        fixAttempts,
        finalOutcome: outcome,
        history,
      };
    }

    const feedback = buildFixFeedback(outcome, options.feedbackOptions);
    history.push({ iteration, outcome, feedback });

    // Don't attempt a fix on the last allowed run — there'd be no run left to verify it.
    if (iteration < maxIterations) {
      await options.applyFix(feedback, iteration);
      fixAttempts += 1;
    } else {
      return {
        status: 'exhausted',
        escalate: true,
        iterations: iteration,
        fixAttempts,
        finalOutcome: outcome,
        finalFeedback: feedback,
        history,
      };
    }
  }

  // Unreachable (the loop returns from inside), but satisfies the type checker.
  /* istanbul ignore next */
  throw new Error('self-correct loop exited unexpectedly');
}
