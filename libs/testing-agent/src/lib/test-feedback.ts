/**
 * Failure diagnostics packaging (HELIX-122): turn a failed {@link TestReport}
 * into concise, actionable diagnostics for the Coding Agent to fix.
 *
 * It lists the failing tests (file · name · message) and includes the raw test
 * **output / stack traces** (truncated), then a re-prompt instructing the agent
 * to fix the code so the tests pass. HELIX-123 drives the re-invoke loop with
 * this. Pure + deterministic; short-circuits to nothing when the tests passed.
 */
import { TestReport } from './report';
import { TestFailure } from './test-results';

export interface FailureDiagnostics {
  /** False when the tests passed — no diagnostics needed. */
  hasFailures: boolean;
  /** The failing tests (possibly truncated). */
  failures: TestFailure[];
  truncated: boolean;
  /** The re-prompt for the Coding Agent (empty when there are no failures). */
  prompt: string;
}

export interface BuildFailureDiagnosticsOptions {
  /** Raw test output (incl. stack traces) to embed, truncated to `maxRawChars`. */
  rawOutput?: string;
  /** Max failing tests listed (default 25). */
  maxFailures?: number;
  /** Max chars of raw output embedded (default 4000). */
  maxRawChars?: number;
}

/** Package a failed test report's failures + stack traces into fix diagnostics. */
export function buildFailureDiagnostics(
  report: TestReport,
  options: BuildFailureDiagnosticsOptions = {},
): FailureDiagnostics {
  const maxFailures = options.maxFailures ?? 25;
  const maxRawChars = options.maxRawChars ?? 4000;
  const all = report.results.failures;

  if (report.passed || all.length === 0) {
    return { hasFailures: false, failures: [], truncated: false, prompt: '' };
  }

  const shown = all.slice(0, maxFailures);
  const truncated = all.length > maxFailures;

  const lines = [
    `The tests failed (${report.results.failed} of ${report.results.total}). Fix the code so the tests pass; they will be re-run.`,
    '',
    '## Failing tests',
    ...shown.map(
      (f) => `- ${f.file ? `${f.file} — ` : ''}${f.name}${f.message ? `: ${f.message}` : ''}`,
    ),
  ];
  if (truncated) lines.push(`- … and ${all.length - maxFailures} more`);

  if (options.rawOutput?.trim()) {
    lines.push('', '## Test output', '```', truncate(options.rawOutput.trim(), maxRawChars), '```');
  }

  return { hasFailures: true, failures: shown, truncated, prompt: lines.join('\n') };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}
