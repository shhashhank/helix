import type { CommandRunner, ExecResult } from '@helix/sandbox';
import { CheckCommand } from '../checks';
import { FixFeedback } from '../feedback';
import { FixApplier, selfCorrect } from '../self-correct';

const checks: CheckCommand[] = [{ name: 'build', command: 'build' }];

/** Runner that exits 0 once `passing()` is true, else exits 1 with tsc-style output. */
function flippableRunner(passing: () => boolean): CommandRunner {
  return {
    async run(command): Promise<ExecResult> {
      const ok = passing();
      return {
        command,
        exitCode: ok ? 0 : 1,
        stdout: ok ? '' : "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
        stderr: '',
        timedOut: false,
        durationMs: 1,
      };
    },
  };
}

describe('selfCorrect', () => {
  it('passes on the first run without attempting a fix', async () => {
    const applyFix = jest.fn<Promise<void>, [FixFeedback, number]>(async () => undefined);
    const result = await selfCorrect(flippableRunner(() => true), { checks, applyFix });

    expect(result.status).toBe('passed');
    expect(result.escalate).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.fixAttempts).toBe(0);
    expect(applyFix).not.toHaveBeenCalled();
  });

  it('fixes a failing build and passes on the next run', async () => {
    let fixed = false;
    let seen: FixFeedback | undefined;
    const applyFix: FixApplier = async (feedback) => {
      seen = feedback;
      fixed = true;
    };

    const result = await selfCorrect(flippableRunner(() => fixed), { checks, applyFix });

    expect(result.status).toBe('passed');
    expect(result.iterations).toBe(2);
    expect(result.fixAttempts).toBe(1);
    expect(seen?.prompt).toContain('TS2304'); // the fix step received real feedback
  });

  it('exhausts the budget and signals escalation when it never passes', async () => {
    const applyFix = jest.fn<Promise<void>, [FixFeedback, number]>(async () => undefined);
    const result = await selfCorrect(flippableRunner(() => false), {
      checks,
      applyFix,
      maxIterations: 3,
    });

    expect(result.status).toBe('exhausted');
    expect(result.escalate).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.fixAttempts).toBe(2); // fix attempted after runs 1 and 2, not after the last
    expect(applyFix).toHaveBeenCalledTimes(2);
    expect(result.finalFeedback?.prompt).toContain('TS2304');
    expect(result.history).toHaveLength(3);
  });

  it('never attempts a fix when maxIterations is 1', async () => {
    const applyFix = jest.fn<Promise<void>, [FixFeedback, number]>(async () => undefined);
    const result = await selfCorrect(flippableRunner(() => false), {
      checks,
      applyFix,
      maxIterations: 1,
    });

    expect(result.status).toBe('exhausted');
    expect(result.fixAttempts).toBe(0);
    expect(applyFix).not.toHaveBeenCalled();
  });
});
