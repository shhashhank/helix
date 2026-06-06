import { AcceptanceCoverage } from '../acceptance-tests';
import { buildTestReport, formatTestReport } from '../report';
import { TestRunResult } from '../test-runner';

const run = (over: Partial<TestRunResult> = {}): TestRunResult => ({
  passed: false,
  exitCode: 1,
  stdout: [
    '  ● sub › subtracts two numbers',
    'Tests:       1 failed, 1 skipped, 8 passed, 10 total',
    'All files |   85.71 |       80 |      90 |   85.71 |',
  ].join('\n'),
  stderr: '',
  timedOut: false,
  durationMs: 1234,
  command: 'pnpm test',
  ...over,
});

describe('buildTestReport', () => {
  it('combines parsed results, coverage, run metadata, and acceptance coverage', () => {
    const acceptance: AcceptanceCoverage = {
      total: 2,
      coveredIndices: [0],
      uncovered: [{ index: 1, criterion: 'List notes returns all notes' }],
      fullyCovered: false,
    };
    const report = buildTestReport(run(), 'jest', { acceptance });

    expect(report.passed).toBe(false);
    expect(report.framework).toBe('jest');
    expect(report.results).toMatchObject({ total: 10, passed: 8, failed: 1, skipped: 1 });
    expect(report.coverage?.lines).toBe(85.71);
    expect(report.acceptance).toBe(acceptance);
    expect(report.durationMs).toBe(1234);
    expect(report.command).toBe('pnpm test');
  });
});

describe('formatTestReport', () => {
  it('renders a failed report with results, coverage, failures, and footer', () => {
    const md = formatTestReport(buildTestReport(run(), 'jest'));
    expect(md).toContain('### ❌ Tests failed');
    expect(md).toContain('**Results:** 10 total — 8 passed, 1 failed, 1 skipped');
    expect(md).toContain('**Coverage:** lines 85.71% · statements 85.71% · branches 80% · functions 90%');
    expect(md).toContain('**Failures:**');
    expect(md).toContain('- sub › subtracts two numbers');
    expect(md).toContain('_pnpm test · 1234ms_');
  });

  it('renders a passed report and lists uncovered acceptance criteria', () => {
    const passing = run({
      passed: true,
      exitCode: 0,
      stdout: 'Tests:       5 passed, 5 total',
    });
    const acceptance: AcceptanceCoverage = {
      total: 2,
      coveredIndices: [0],
      uncovered: [{ index: 1, criterion: 'List notes' }],
      fullyCovered: false,
    };
    const md = formatTestReport(buildTestReport(passing, 'jest', { acceptance }));
    expect(md).toContain('### ✅ Tests passed');
    expect(md).toContain('**Acceptance criteria:** 1/2 covered');
    expect(md).toContain('- ⚠️ uncovered: List notes');
    expect(md).not.toContain('**Failures:**'); // none
  });
});
