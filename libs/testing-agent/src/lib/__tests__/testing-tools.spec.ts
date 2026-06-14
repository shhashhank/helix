import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall } from '@helix/agent';
import { type CommandRunner, type ExecResult, type RunOptions, LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { TESTING_TOOLS, TESTING_TOOL_NAMES, testingTools } from '../testing-tools';

const call = (name: string, input: unknown): ToolCall => ({ id: `t-${name}`, name, input });

interface RecordedCall {
  command: string;
  options: RunOptions;
}

/** A fake CommandRunner that records calls and returns a canned result (no real spawn). */
const fakeRunner = (
  result: Partial<ExecResult> = {},
): { runner: CommandRunner; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const runner: CommandRunner = {
    run: async (command, options = {}) => {
      calls.push({ command, options });
      return {
        command: [command, ...(options.args ?? [])].join(' '),
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 5,
        ...result,
      };
    },
  };
  return { runner, calls };
};

describe('testingTools', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-testing-tools-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('exposes run_command + run_tests, matching the tool defs', () => {
    const { runner } = fakeRunner();
    const tools = testingTools(sandbox, { runner });
    expect(Object.keys(tools).sort()).toEqual(['run_command', 'run_tests']);
    expect(TESTING_TOOLS.map((t) => t.name).sort()).toEqual(['run_command', 'run_tests']);
    for (const tool of TESTING_TOOLS) expect(tool.inputSchema.type).toBe('object');
  });

  describe('run_command', () => {
    it('forwards command + args + cwd + timeout to the runner', async () => {
      const { runner, calls } = fakeRunner({ stdout: 'built ok' });
      const tools = testingTools(sandbox, { runner });

      const res = await tools.run_command(
        call('run_command', { command: 'pnpm', args: ['build'], cwd: 'pkg', timeoutMs: 1234 }),
      );

      expect(calls[0]).toEqual({ command: 'pnpm', options: { args: ['build'], cwd: 'pkg', timeoutMs: 1234 } });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('exit 0');
      expect(res.content).toContain('built ok');
    });

    it('reports a non-zero exit as an isError result', async () => {
      const { runner } = fakeRunner({ exitCode: 1, stderr: 'tsc: error TS2304' });
      const tools = testingTools(sandbox, { runner });

      const res = await tools.run_command(call('run_command', { command: 'pnpm', args: ['build'] }));
      expect(res.isError).toBe(true);
      expect(res.content).toContain('tsc: error TS2304');
    });

    it('applies the default timeout when a call omits one', async () => {
      const { runner, calls } = fakeRunner();
      const tools = testingTools(sandbox, { runner, defaultTimeoutMs: 9000 });

      await tools.run_command(call('run_command', { command: 'ls' }));
      expect(calls[0].options.timeoutMs).toBe(9000);
    });

    it('returns an isError result on invalid input', async () => {
      const { runner } = fakeRunner();
      const tools = testingTools(sandbox, { runner });
      const res = await tools.run_command(call('run_command', { command: '' }));
      expect(res.isError).toBe(true);
    });
  });

  describe('run_tests', () => {
    it('runs the default Node test command and reports a passing run as the test artifact', async () => {
      const { runner, calls } = fakeRunner({ stdout: 'Tests: 3 passed, 3 total' });
      const tools = testingTools(sandbox, { runner });

      const res = await tools.run_tests(call('run_tests', { framework: 'jest' }));

      expect(calls[0]).toMatchObject({ command: 'pnpm', options: { args: ['test'] } });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Tests passed');
      expect(res.content).toContain('3 total');
    });

    it('reports a failing run as an isError result', async () => {
      const { runner } = fakeRunner({
        exitCode: 1,
        stdout: 'Tests: 1 failed, 2 passed, 3 total\n  ● adds two numbers',
      });
      const tools = testingTools(sandbox, { runner });

      const res = await tools.run_tests(call('run_tests', { framework: 'jest' }));
      expect(res.isError).toBe(true);
      expect(res.content).toContain('Tests failed');
      expect(res.content).toContain('1 failed');
    });

    it('auto-detects pytest from a conftest.py in the workspace', async () => {
      await writeFile(sandbox.resolve('conftest.py'), '# pytest fixtures\n');
      const { runner, calls } = fakeRunner({ stdout: '1 passed' });
      const tools = testingTools(sandbox, { runner });

      await tools.run_tests(call('run_tests', {}));
      expect(calls[0].command).toBe('pytest');
    });

    it('auto-detects a Node framework from package.json deps', async () => {
      await writeFile(sandbox.resolve('package.json'), JSON.stringify({ devDependencies: { vitest: '^1' } }));
      const { runner, calls } = fakeRunner({ stdout: 'Tests: 0 total' });
      const tools = testingTools(sandbox, { runner });

      await tools.run_tests(call('run_tests', {}));
      expect(calls[0]).toMatchObject({ command: 'pnpm', options: { args: ['test'] } });
    });

    it('honours an explicit test command', async () => {
      const { runner, calls } = fakeRunner({ stdout: 'Tests: 1 passed, 1 total' });
      const tools = testingTools(sandbox, { runner });

      await tools.run_tests(call('run_tests', { command: 'npx', args: ['jest', '--ci'] }));
      expect(calls[0]).toEqual({ command: 'npx', options: { args: ['jest', '--ci'], cwd: undefined, timeoutMs: undefined } });
    });
  });
});
