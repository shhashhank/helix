import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import { defaultTestCommand, detectFramework, runTests } from '../test-runner';

const pkg = (deps: Record<string, string>) => ({
  path: 'package.json',
  content: JSON.stringify({ devDependencies: deps }),
});

describe('detectFramework', () => {
  it('detects node frameworks from package.json deps', () => {
    expect(detectFramework([pkg({ vitest: '^1' })])).toBe('vitest');
    expect(detectFramework([pkg({ jest: '^30', 'ts-jest': '^29' })])).toBe('jest');
    expect(detectFramework([pkg({ mocha: '^10' })])).toBe('mocha');
  });

  it('detects pytest from python markers', () => {
    expect(detectFramework([{ path: 'tests/conftest.py', content: '' }])).toBe('pytest');
    expect(detectFramework([{ path: 'pyproject.toml', content: '[tool.pytest.ini_options]' }])).toBe('pytest');
  });

  it('returns undefined when nothing is recognised or package.json is malformed', () => {
    expect(detectFramework([{ path: 'src/a.ts', content: 'x' }])).toBeUndefined();
    expect(detectFramework([{ path: 'package.json', content: '{ not json' }])).toBeUndefined();
  });
});

describe('defaultTestCommand', () => {
  it('uses the package test script for node frameworks, pytest for python', () => {
    expect(defaultTestCommand('jest', 'pnpm')).toEqual({ command: 'pnpm', args: ['test'] });
    expect(defaultTestCommand('vitest', 'npm')).toEqual({ command: 'npm', args: ['test'] });
    expect(defaultTestCommand('pytest')).toEqual({ command: 'pytest', args: [] });
  });
});

function fakeRunner(
  result: Partial<ExecResult>,
  onRun?: (command: string, options?: RunOptions) => void,
): CommandRunner {
  return {
    async run(command: string, options: RunOptions = {}): Promise<ExecResult> {
      onRun?.(command, options);
      return {
        command: [command, ...(options.args ?? [])].join(' '),
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
        ...result,
      };
    },
  };
}

describe('runTests', () => {
  it('passes when the test command exits zero, using the framework default + cwd/timeout', async () => {
    let seen: { command: string; options?: RunOptions } | undefined;
    const runner = fakeRunner({ exitCode: 0, stdout: 'ok' }, (command, options) => (seen = { command, options }));

    const result = await runTests(runner, { framework: 'jest', cwd: 'repo', timeoutMs: 60_000 });

    expect(result.passed).toBe(true);
    expect(result.command).toBe('pnpm test');
    expect(seen?.command).toBe('pnpm');
    expect(seen?.options).toMatchObject({ args: ['test'], cwd: 'repo', timeoutMs: 60_000 });
  });

  it('fails when the test command exits non-zero', async () => {
    const result = await runTests(fakeRunner({ exitCode: 1, stderr: '1 failed' }), { framework: 'jest' });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('fails on timeout', async () => {
    const result = await runTests(fakeRunner({ exitCode: null, timedOut: true }), { framework: 'pytest' });
    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('honours an explicit command override', async () => {
    let seen: string | undefined;
    const runner = fakeRunner({}, (command) => (seen = command));
    await runTests(runner, { command: { command: 'jest', args: ['--runInBand'] } });
    expect(seen).toBe('jest');
  });
});
