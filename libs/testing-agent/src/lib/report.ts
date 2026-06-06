/**
 * Test report artifact (HELIX-121): package a parsed test run into a structured
 * {@link TestReport} (to store) plus a markdown summary (to surface in the PR /
 * run UI).
 *
 * The structured report combines the normalized results + coverage (HELIX-120)
 * with optional acceptance-criteria coverage (HELIX-118) and run metadata; it's
 * also the input the failure-feedback loop (HELIX-38) reads. Pure + deterministic.
 */
import { AcceptanceCoverage } from './acceptance-tests';
import { Coverage, parseTestRun, TestResults } from './test-results';
import { TestRunResult } from './test-runner';
import { TestFramework } from './test-generation';

export interface TestReport {
  passed: boolean;
  framework: TestFramework;
  results: TestResults;
  coverage?: Coverage;
  /** Acceptance-criteria coverage from generation (optional). */
  acceptance?: AcceptanceCoverage;
  durationMs: number;
  command: string;
}

export interface BuildTestReportOptions {
  acceptance?: AcceptanceCoverage;
}

/** Build the structured report from a test run. */
export function buildTestReport(
  run: TestRunResult,
  framework: TestFramework,
  options: BuildTestReportOptions = {},
): TestReport {
  const parsed = parseTestRun(run, framework);
  return {
    passed: parsed.passed,
    framework,
    results: parsed.results,
    coverage: parsed.coverage,
    acceptance: options.acceptance,
    durationMs: run.durationMs,
    command: run.command,
  };
}

/** Render the report as a markdown summary for the PR / run UI. */
export function formatTestReport(report: TestReport): string {
  const { results } = report;
  const lines: string[] = [
    `### ${report.passed ? '✅ Tests passed' : '❌ Tests failed'}`,
    '',
    `**Results:** ${results.total} total — ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`,
  ];

  if (report.coverage) {
    const c = report.coverage;
    const parts = [
      c.lines !== undefined ? `lines ${c.lines}%` : undefined,
      c.statements !== undefined ? `statements ${c.statements}%` : undefined,
      c.branches !== undefined ? `branches ${c.branches}%` : undefined,
      c.functions !== undefined ? `functions ${c.functions}%` : undefined,
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`**Coverage:** ${parts.join(' · ')}`);
  }

  if (report.acceptance) {
    const a = report.acceptance;
    lines.push(`**Acceptance criteria:** ${a.coveredIndices.length}/${a.total} covered`);
    for (const u of a.uncovered) lines.push(`- ⚠️ uncovered: ${u.criterion}`);
  }

  if (results.failures.length > 0) {
    lines.push('', '**Failures:**');
    for (const f of results.failures) {
      lines.push(`- ${f.file ? `${f.file} — ` : ''}${f.name}${f.message ? `: ${f.message}` : ''}`);
    }
  }

  lines.push('', `_${report.command} · ${report.durationMs}ms_`);
  return lines.join('\n');
}
