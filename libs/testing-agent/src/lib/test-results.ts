/**
 * Test result + coverage parsing (HELIX-120): normalise a test run's raw output
 * into a common {@link TestResults} shape across frameworks.
 *
 * Counts are extracted generically (every framework prints "N passed / M failed"
 * in some form), while failure details and coverage are parsed per framework
 * (Jest/Vitest, PyTest, Mocha) with a graceful fallback to just the counts. The
 * authoritative pass/fail stays the run's exit code; parsing only adds detail.
 */
import { TestFramework } from './test-generation';
import { TestRunResult } from './test-runner';

export interface TestFailure {
  name: string;
  message?: string;
  file?: string;
}

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

/** Coverage percentages (0–100), where available. */
export interface Coverage {
  lines?: number;
  statements?: number;
  functions?: number;
  branches?: number;
}

export interface ParsedTestRun {
  /** Authoritative pass/fail (from the run's exit code). */
  passed: boolean;
  results: TestResults;
  coverage?: Coverage;
}

/** Parse normalized counts + failures from a framework's output. */
export function parseTestResults(output: string, framework: TestFramework): TestResults {
  const counts = extractCounts(output);
  return { ...counts, failures: parseFailures(output, framework) };
}

function extractCounts(output: string): Omit<TestResults, 'failures'> {
  // Jest/Vitest print a `Tests:`/`Tests ` summary line plus a separate
  // `Test Suites:` line; scope to the test line so suite counts don't shadow it.
  const testsLine = output.match(/^\s*Tests[: ].*$/im);
  const scope = testsLine ? testsLine[0] : output;
  const num = (re: RegExp): number => {
    const m = scope.match(re);
    return m ? Number(m[1]) : 0;
  };
  const passed = num(/(\d+)\s+(?:passed|passing)/i);
  const failed = num(/(\d+)\s+(?:failed|failing)/i);
  const skipped = num(/(\d+)\s+(?:skipped|pending)/i);
  const total = num(/(\d+)\s+total/i) || passed + failed + skipped;
  return { total, passed, failed, skipped };
}

function parseFailures(output: string, framework: TestFramework): TestFailure[] {
  if (framework === 'pytest') {
    const failures: TestFailure[] = [];
    const re = /^FAILED\s+(\S+)(?:\s+-\s+(.*))?$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output))) {
      failures.push({ name: m[1], message: m[2]?.trim(), file: m[1].split('::')[0] });
    }
    return failures;
  }

  // Jest / Vitest print a `●`-prefixed header per failure.
  const seen = new Set<string>();
  const failures: TestFailure[] = [];
  const re = /^\s*●\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output))) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      failures.push({ name });
    }
  }
  return failures;
}

/** Parse coverage percentages from a framework's output, if present. */
export function parseCoverage(output: string, framework: TestFramework): Coverage | undefined {
  if (framework === 'pytest') {
    // pytest-cov: `TOTAL    100    15    85%`
    const m = output.match(/^TOTAL\s+.*?(\d+(?:\.\d+)?)%/m);
    return m ? { lines: Number(m[1]) } : undefined;
  }

  // Jest/Vitest text reporter: `All files | 85.71 | 80 | 90 | 85.71 |`
  // columns: % Stmts | % Branch | % Funcs | % Lines
  const m = output.match(
    /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
  );
  if (!m) return undefined;
  return {
    statements: Number(m[1]),
    branches: Number(m[2]),
    functions: Number(m[3]),
    lines: Number(m[4]),
  };
}

/** Parse a whole {@link TestRunResult}: counts, failures, and coverage. */
export function parseTestRun(run: TestRunResult, framework: TestFramework): ParsedTestRun {
  const output = `${run.stdout}\n${run.stderr}`;
  return {
    passed: run.passed,
    results: parseTestResults(output, framework),
    coverage: parseCoverage(output, framework),
  };
}
