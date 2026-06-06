import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import { FailureDiagnostics } from '../test-feedback';
import { runTestFeedbackLoop, TestFixApplier } from '../test-feedback-loop';

const PASS_OUTPUT = 'Tests:       5 passed, 5 total';
const FAIL_OUTPUT = ['  ● adds two numbers', 'Tests:       1 failed, 4 passed, 5 total'].join('\n');

/** Runner whose output is failing until `passing()` flips to true. */
function flippableRunner(passing: () => boolean): CommandRunner {
  return {
    async run(command: string, options: RunOptions = {}): Promise<ExecResult> {
      const ok = passing();
      return {
        command: [command, ...(options.args ?? [])].join(' '),
        exitCode: ok ? 0 : 1,
        stdout: ok ? PASS_OUTPUT : FAIL_OUTPUT,
        stderr: '',
        timedOut: false,
        durationMs: 1,
      };
    },
  };
}

describe('runTestFeedbackLoop', () => {
  it('passes on the first run without attempting a fix', async () => {
    const applyFix = jest.fn<Promise<void>, [FailureDiagnostics, number]>(async () => undefined);
    const result = await runTestFeedbackLoop(flippableRunner(() => true), { framework: 'jest', applyFix });

    expect(result.status).toBe('passed');
    expect(result.escalate).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.fixAttempts).toBe(0);
    expect(applyFix).not.toHaveBeenCalled();
  });

  it('fixes failing tests and passes on the next run', async () => {
    let fixed = false;
    let seen: FailureDiagnostics | undefined;
    const applyFix: TestFixApplier = async (diagnostics) => {
      seen = diagnostics;
      fixed = true;
    };

    const result = await runTestFeedbackLoop(flippableRunner(() => fixed), { framework: 'jest', applyFix });

    expect(result.status).toBe('passed');
    expect(result.iterations).toBe(2);
    expect(result.fixAttempts).toBe(1);
    expect(seen?.hasFailures).toBe(true);
    expect(seen?.prompt).toContain('adds two numbers'); // the fix step got real diagnostics
  });

  it('exhausts the budget and signals escalation when tests keep failing', async () => {
    const applyFix = jest.fn<Promise<void>, [FailureDiagnostics, number]>(async () => undefined);
    const result = await runTestFeedbackLoop(flippableRunner(() => false), {
      framework: 'jest',
      applyFix,
      maxIterations: 3,
    });

    expect(result.status).toBe('exhausted');
    expect(result.escalate).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.fixAttempts).toBe(2); // fix after runs 1 and 2, not the last
    expect(applyFix).toHaveBeenCalledTimes(2);
    expect(result.finalDiagnostics?.hasFailures).toBe(true);
    expect(result.history).toHaveLength(3);
  });

  it('never attempts a fix when maxIterations is 1', async () => {
    const applyFix = jest.fn<Promise<void>, [FailureDiagnostics, number]>(async () => undefined);
    const result = await runTestFeedbackLoop(flippableRunner(() => false), {
      framework: 'jest',
      applyFix,
      maxIterations: 1,
    });

    expect(result.status).toBe('exhausted');
    expect(result.fixAttempts).toBe(0);
    expect(applyFix).not.toHaveBeenCalled();
  });
});
