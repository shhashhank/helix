import { ChecksOutcome } from '../checks';
import {
  buildFixFeedback,
  parseEslintDiagnostics,
  parseTypeScriptDiagnostics,
} from '../feedback';

const tscOutput = [
  "src/note/note.service.ts(12,5): error TS2304: Cannot find name 'foo'.",
  "src/note/note.controller.ts(3,10): error TS2307: Cannot find module './nope'.",
  'Found 2 errors.',
].join('\n');

const eslintOutput = [
  '/work/src/app.ts',
  '  10:7   error    Unexpected console statement  no-console',
  '  22:1   warning  Missing return type           @typescript-eslint/explicit-function-return-type',
  '',
  '✖ 2 problems (1 error, 1 warning)',
].join('\n');

const result = (over: Partial<ChecksOutcome['results'][number]>) => ({
  name: 'build',
  ok: false,
  exitCode: 2,
  timedOut: false,
  stdout: '',
  stderr: '',
  durationMs: 5,
  ...over,
});

describe('parseTypeScriptDiagnostics', () => {
  it('parses file, position, code, and message', () => {
    const diags = parseTypeScriptDiagnostics(tscOutput);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toEqual({
      file: 'src/note/note.service.ts',
      line: 12,
      column: 5,
      severity: 'error',
      code: 'TS2304',
      message: "Cannot find name 'foo'.",
    });
  });
});

describe('parseEslintDiagnostics', () => {
  it('parses positions, severity, rule, and attaches the file header', () => {
    const diags = parseEslintDiagnostics(eslintOutput);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toMatchObject({
      file: '/work/src/app.ts',
      line: 10,
      column: 7,
      severity: 'error',
      code: 'no-console',
      message: 'Unexpected console statement',
    });
    expect(diags[1]).toMatchObject({ severity: 'warning', line: 22 });
  });
});

describe('buildFixFeedback', () => {
  it('returns ok with an empty prompt when the checks passed', () => {
    const fb = buildFixFeedback({ ok: true, results: [] });
    expect(fb.ok).toBe(true);
    expect(fb.prompt).toBe('');
  });

  it('parses failed checks into diagnostics and a re-prompt', () => {
    const outcome: ChecksOutcome = {
      ok: false,
      results: [result({ name: 'build', stdout: tscOutput })],
    };
    const fb = buildFixFeedback(outcome);
    expect(fb.ok).toBe(false);
    expect(fb.diagnostics).toHaveLength(2);
    expect(fb.prompt).toContain('## build (exit 2)');
    expect(fb.prompt).toContain('[error]');
    expect(fb.prompt).toContain('TS2304');
    expect(fb.prompt).toMatch(/checks failed/i);
  });

  it('falls back to raw output when nothing parses', () => {
    const outcome: ChecksOutcome = {
      ok: false,
      results: [result({ name: 'build', stderr: 'totally unstructured boom', exitCode: 1 })],
    };
    const fb = buildFixFeedback(outcome);
    expect(fb.diagnostics).toHaveLength(0);
    expect(fb.checks[0].raw).toContain('totally unstructured boom');
    expect(fb.prompt).toContain('totally unstructured boom');
  });

  it('marks a timed-out check and notes it in the prompt', () => {
    const outcome: ChecksOutcome = {
      ok: false,
      results: [result({ name: 'build', timedOut: true, exitCode: null })],
    };
    expect(buildFixFeedback(outcome).prompt).toContain('## build (timed out)');
  });

  it('caps the number of diagnostics and notes the omission', () => {
    const many = Array.from({ length: 60 }, (_, i) => `src/f.ts(${i + 1},1): error TS1000: e${i}.`).join('\n');
    const fb = buildFixFeedback({ ok: false, results: [result({ stdout: many })] }, { maxDiagnostics: 50 });
    expect(fb.truncated).toBe(true);
    expect(fb.diagnostics).toHaveLength(50);
    expect(fb.prompt).toMatch(/10 more diagnostic\(s\) omitted/);
  });
});
