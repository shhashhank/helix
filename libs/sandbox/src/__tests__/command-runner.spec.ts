import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCommandRunner } from '../command-runner';
import { LocalSandboxProvider } from '../local-sandbox';
import { Sandbox, SandboxPathError } from '../sandbox';

const NODE = process.execPath; // absolute path to the running node binary

describe('LocalCommandRunner', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;
  let runner: LocalCommandRunner;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-run-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
    runner = new LocalCommandRunner(sandbox);
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('captures stdout + a zero exit code', async () => {
    const r = await runner.run(NODE, { args: ['-e', "process.stdout.write('hello')"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hello');
    expect(r.timedOut).toBe(false);
  });

  it('captures stderr + a non-zero exit code', async () => {
    const r = await runner.run(NODE, { args: ['-e', "process.stderr.write('boom'); process.exit(3)"] });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('boom');
  });

  it('runs in the sandbox workspace as cwd', async () => {
    await writeFile(sandbox.resolve('marker.txt'), 'x');
    const r = await runner.run(NODE, {
      args: ['-e', "process.stdout.write(String(require('fs').existsSync('marker.txt')))"],
    });
    expect(r.stdout).toBe('true');
  });

  it('kills a process that exceeds the timeout', async () => {
    const r = await runner.run(NODE, { args: ['-e', 'setTimeout(() => {}, 10000)'], timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
  });

  it('reports a command that cannot start (null exit + error on stderr)', async () => {
    const r = await runner.run('helix-no-such-binary-xyz');
    expect(r.exitCode).toBeNull();
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it('refuses a cwd that escapes the sandbox', () => {
    expect(() => runner.run(NODE, { cwd: '../..' })).toThrow(SandboxPathError);
  });
});
