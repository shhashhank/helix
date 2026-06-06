import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import { nodeChecks, runChecks } from '../checks';

/** A fake runner that returns a scripted exit code per command name. */
function fakeRunner(
  exitByCommand: Record<string, number>,
  calls?: string[],
): CommandRunner {
  return {
    async run(command: string, options: RunOptions = {}): Promise<ExecResult> {
      calls?.push(command);
      const code = exitByCommand[command] ?? 0;
      return {
        command: [command, ...(options.args ?? [])].join(' '),
        exitCode: code,
        stdout: `${command} ran`,
        stderr: code === 0 ? '' : `${command} failed`,
        timedOut: false,
        durationMs: 1,
      };
    },
  };
}

describe('runChecks', () => {
  it('passes when every check exits zero', async () => {
    const runner = fakeRunner({ pnpm: 0 });
    const outcome = await runChecks(runner, nodeChecks('pnpm'));
    expect(outcome.ok).toBe(true);
    expect(outcome.results.map((r) => r.name)).toEqual(['build', 'lint']);
    expect(outcome.results.every((r) => r.ok)).toBe(true);
  });

  it('fails the outcome when any check exits non-zero', async () => {
    const runner = fakeRunner({ tsc: 2, eslint: 0 });
    const outcome = await runChecks(runner, [
      { name: 'build', command: 'tsc' },
      { name: 'lint', command: 'eslint' },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.results.find((r) => r.name === 'build')).toMatchObject({ ok: false, exitCode: 2 });
    expect(outcome.results.find((r) => r.name === 'lint')).toMatchObject({ ok: true });
  });

  it('stops after the first failure when stopOnFailure is set', async () => {
    const calls: string[] = [];
    const runner = fakeRunner({ tsc: 1, eslint: 0 }, calls);
    const outcome = await runChecks(
      runner,
      [
        { name: 'build', command: 'tsc' },
        { name: 'lint', command: 'eslint' },
      ],
      { stopOnFailure: true },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.results).toHaveLength(1);
    expect(calls).toEqual(['tsc']); // lint never ran
  });

  it('treats a timed-out check as a failure', async () => {
    const runner: CommandRunner = {
      async run(command) {
        return { command, exitCode: null, stdout: '', stderr: '', timedOut: true, durationMs: 5 };
      },
    };
    const outcome = await runChecks(runner, [{ name: 'build', command: 'pnpm', args: ['build'] }]);
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]).toMatchObject({ ok: false, timedOut: true });
  });
});

describe('nodeChecks', () => {
  it('uses pnpm <script> by default', () => {
    expect(nodeChecks()).toEqual([
      { name: 'build', command: 'pnpm', args: ['build'] },
      { name: 'lint', command: 'pnpm', args: ['lint'] },
    ]);
  });

  it('uses npm run <script> for npm', () => {
    expect(nodeChecks('npm')).toEqual([
      { name: 'build', command: 'npm', args: ['run', 'build'] },
      { name: 'lint', command: 'npm', args: ['run', 'lint'] },
    ]);
  });
});
