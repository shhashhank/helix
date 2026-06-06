import { TestRunResult } from '../test-runner';
import { parseCoverage, parseTestResults, parseTestRun } from '../test-results';

const jestOutput = [
  'PASS src/add.spec.ts',
  'FAIL src/sub.spec.ts',
  '  ● sub › subtracts two numbers',
  '    expect(received).toBe(expected)',
  '',
  'Test Suites: 1 failed, 1 passed, 2 total',
  'Tests:       1 failed, 1 skipped, 8 passed, 10 total',
].join('\n');

const jestCoverage = [
  'File      | % Stmts | % Branch | % Funcs | % Lines |',
  'All files |   85.71 |       80 |      90 |   85.71 |',
].join('\n');

const pytestOutput = [
  'FAILED tests/test_notes.py::test_create - AssertionError: expected 201',
  '=== 1 failed, 9 passed in 0.42s ===',
].join('\n');

const pytestCoverage = ['Name        Stmts   Miss  Cover', 'TOTAL         120     18    85%'].join('\n');

describe('parseTestResults', () => {
  it('normalises Jest counts + failures', () => {
    const r = parseTestResults(jestOutput, 'jest');
    expect(r).toMatchObject({ total: 10, passed: 8, failed: 1, skipped: 1 });
    expect(r.failures).toEqual([{ name: 'sub › subtracts two numbers' }]);
  });

  it('normalises PyTest counts + failures', () => {
    const r = parseTestResults(pytestOutput, 'pytest');
    expect(r).toMatchObject({ passed: 9, failed: 1, total: 10 });
    expect(r.failures[0]).toMatchObject({
      name: 'tests/test_notes.py::test_create',
      file: 'tests/test_notes.py',
      message: 'AssertionError: expected 201',
    });
  });

  it('parses Mocha-style passing/failing counts', () => {
    const r = parseTestResults('8 passing\n2 failing\n1 pending', 'mocha');
    expect(r).toMatchObject({ passed: 8, failed: 2, skipped: 1, total: 11 });
  });
});

describe('parseCoverage', () => {
  it('parses the Jest coverage summary row', () => {
    expect(parseCoverage(jestCoverage, 'jest')).toEqual({
      statements: 85.71,
      branches: 80,
      functions: 90,
      lines: 85.71,
    });
  });

  it('parses the pytest-cov TOTAL line', () => {
    expect(parseCoverage(pytestCoverage, 'pytest')).toEqual({ lines: 85 });
  });

  it('returns undefined when there is no coverage', () => {
    expect(parseCoverage('no coverage here', 'jest')).toBeUndefined();
  });
});

describe('parseTestRun', () => {
  it('combines the run result, parsed counts, and coverage', () => {
    const run: TestRunResult = {
      passed: false,
      exitCode: 1,
      stdout: `${jestOutput}\n${jestCoverage}`,
      stderr: '',
      timedOut: false,
      durationMs: 100,
      command: 'pnpm test',
    };
    const parsed = parseTestRun(run, 'jest');
    expect(parsed.passed).toBe(false); // from exit code
    expect(parsed.results.failed).toBe(1);
    expect(parsed.coverage?.lines).toBe(85.71);
  });
});
