/**
 * Test failure feedback loop (HELIX-123): the driver that closes the loop when
 * generated tests fail — run tests → if they fail, package diagnostics
 * (HELIX-122) → re-invoke the Coding Agent's fix step → re-run — bounded by an
 * iteration cap, escalating to a human when the budget runs out.
 *
 * Mirrors the build/lint self-correction loop (HELIX-108), but driven by test
 * results. The fix step is an injected callback (the Coding Agent stays in the
 * caller), so the loop is fully offline-testable; a fix is never attempted on the
 * last run (nothing left to verify it).
 */
import type { CommandRunner } from '@helix/sandbox';
import { buildTestReport, TestReport } from './report';
import { buildFailureDiagnostics, BuildFailureDiagnosticsOptions, FailureDiagnostics } from './test-feedback';
import { runTests, TestCommand, PackageManager } from './test-runner';
import { TestFramework } from './test-generation';

/** Apply a fix from the diagnostics (e.g. re-invoke the Coding Agent). */
export type TestFixApplier = (diagnostics: FailureDiagnostics, iteration: number) => Promise<void>;

export interface TestFeedbackLoopOptions {
  framework: TestFramework;
  applyFix: TestFixApplier;
  /** Max number of test runs (default 3, min 1). */
  maxIterations?: number;
  cwd?: string;
  timeoutMs?: number;
  packageManager?: PackageManager;
  /** Explicit test command (overrides the framework default). */
  command?: TestCommand;
  feedbackOptions?: BuildFailureDiagnosticsOptions;
}

export type TestFeedbackStatus = 'passed' | 'exhausted';

export interface TestFeedbackAttempt {
  iteration: number;
  report: TestReport;
  /** Diagnostics from a failing run (absent when it passed). */
  diagnostics?: FailureDiagnostics;
}

export interface TestFeedbackResult {
  status: TestFeedbackStatus;
  /** True when the budget ran out with tests still failing — escalate to a human. */
  escalate: boolean;
  iterations: number;
  fixAttempts: number;
  finalReport: TestReport;
  finalDiagnostics?: FailureDiagnostics;
  history: TestFeedbackAttempt[];
}

/**
 * Run tests, and on failure feed diagnostics to `applyFix` and re-run, up to
 * `maxIterations`. Returns `passed` as soon as the tests pass, or `exhausted`
 * (with `escalate: true`) once the budget is spent.
 */
export async function runTestFeedbackLoop(
  runner: CommandRunner,
  options: TestFeedbackLoopOptions,
): Promise<TestFeedbackResult> {
  const maxIterations = Math.max(1, options.maxIterations ?? 3);
  const history: TestFeedbackAttempt[] = [];
  let fixAttempts = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const run = await runTests(runner, {
      framework: options.framework,
      command: options.command,
      packageManager: options.packageManager,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    const report = buildTestReport(run, options.framework);

    if (report.passed) {
      history.push({ iteration, report });
      return {
        status: 'passed',
        escalate: false,
        iterations: iteration,
        fixAttempts,
        finalReport: report,
        history,
      };
    }

    const diagnostics = buildFailureDiagnostics(report, {
      rawOutput: `${run.stdout}\n${run.stderr}`,
      ...options.feedbackOptions,
    });
    history.push({ iteration, report, diagnostics });

    if (iteration < maxIterations) {
      await options.applyFix(diagnostics, iteration);
      fixAttempts += 1;
    } else {
      return {
        status: 'exhausted',
        escalate: true,
        iterations: iteration,
        fixAttempts,
        finalReport: report,
        finalDiagnostics: diagnostics,
        history,
      };
    }
  }

  /* istanbul ignore next */
  throw new Error('test feedback loop exited unexpectedly');
}
