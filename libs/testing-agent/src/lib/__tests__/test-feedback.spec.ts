import { TestReport } from '../report';
import { TestFailure, TestResults } from '../test-results';
import { buildFailureDiagnostics } from '../test-feedback';

function report(
  over: { passed?: boolean; results?: Partial<TestResults>; failures?: TestFailure[] } = {},
): TestReport {
  const failures = over.failures ?? over.results?.failures ?? [];
  return {
    passed: over.passed ?? failures.length === 0,
    framework: 'jest',
    results: {
      total: over.results?.total ?? 10,
      passed: over.results?.passed ?? 10 - failures.length,
      failed: over.results?.failed ?? failures.length,
      skipped: over.results?.skipped ?? 0,
      failures,
    },
    durationMs: 100,
    command: 'pnpm test',
  };
}

describe('buildFailureDiagnostics', () => {
  it('returns no diagnostics when the tests passed', () => {
    const d = buildFailureDiagnostics(report({ passed: true }));
    expect(d.hasFailures).toBe(false);
    expect(d.prompt).toBe('');
  });

  it('lists failing tests, embeds the stack-trace output, and re-prompts', () => {
    const d = buildFailureDiagnostics(
      report({
        failures: [
          { file: 'src/sub.spec.ts', name: 'sub › subtracts', message: 'expected 1 to be 2' },
        ],
        results: { total: 10, passed: 9, failed: 1, skipped: 0, failures: [] },
      }),
      { rawOutput: 'AssertionError: expected 1 to be 2\n  at sub (src/sub.ts:4:5)' },
    );

    expect(d.hasFailures).toBe(true);
    expect(d.prompt).toMatch(/tests failed \(1 of 10\)/);
    expect(d.prompt).toContain('## Failing tests');
    expect(d.prompt).toContain('- src/sub.spec.ts — sub › subtracts: expected 1 to be 2');
    expect(d.prompt).toContain('## Test output');
    expect(d.prompt).toContain('at sub (src/sub.ts:4:5)'); // stack trace embedded
  });

  it('renders failures without a file or message gracefully', () => {
    const d = buildFailureDiagnostics(report({ failures: [{ name: 'a flaky test' }] }));
    expect(d.prompt).toContain('- a flaky test');
  });

  it('caps the failing-test list and notes the omission', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `test ${i}` }));
    const d = buildFailureDiagnostics(report({ failures: many }), { maxFailures: 25 });
    expect(d.truncated).toBe(true);
    expect(d.failures).toHaveLength(25);
    expect(d.prompt).toContain('… and 5 more');
  });

  it('truncates over-long raw output', () => {
    const d = buildFailureDiagnostics(report({ failures: [{ name: 'x' }] }), {
      rawOutput: 'y'.repeat(100),
      maxRawChars: 20,
    });
    expect(d.prompt).toContain('… (truncated)');
  });
});
