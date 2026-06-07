import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import { buildCommand, detectBuildStrategy, ProjectFile, runBuild } from '../build';

const file = (path: string): ProjectFile => ({ path, content: '' });

describe('detectBuildStrategy', () => {
  it('prefers a Dockerfile when present', () => {
    expect(detectBuildStrategy([file('package.json'), file('Dockerfile')])).toEqual({
      kind: 'dockerfile',
      dockerfile: 'Dockerfile',
    });
  });

  it('falls back to a language buildpack', () => {
    expect(detectBuildStrategy([file('package.json')])).toEqual({ kind: 'buildpack', language: 'node' });
    expect(detectBuildStrategy([file('go.mod')])).toEqual({ kind: 'buildpack', language: 'go' });
    expect(detectBuildStrategy([file('pyproject.toml')])).toEqual({ kind: 'buildpack', language: 'python' });
    expect(detectBuildStrategy([file('pom.xml')])).toEqual({ kind: 'buildpack', language: 'java' });
    expect(detectBuildStrategy([file('README.md')])).toEqual({ kind: 'buildpack', language: 'unknown' });
  });
});

describe('buildCommand', () => {
  it('builds a docker command for a Dockerfile strategy', () => {
    expect(
      buildCommand({ kind: 'dockerfile', dockerfile: 'docker/Dockerfile' }, { image: 'app:1' }),
    ).toEqual({ command: 'docker', args: ['build', '-t', 'app:1', '-f', 'docker/Dockerfile', '.'] });
  });

  it('builds a pack command for a buildpack strategy, with the builder', () => {
    expect(buildCommand({ kind: 'buildpack', language: 'node' }, { image: 'app:1', builder: 'heroku/builder:24' })).toEqual({
      command: 'pack',
      args: ['build', 'app:1', '--builder', 'heroku/builder:24'],
    });
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

describe('runBuild', () => {
  it('runs the build command and reports ok on a zero exit', async () => {
    let seen: { command: string; options?: RunOptions } | undefined;
    const runner = fakeRunner({ exitCode: 0, stdout: 'built' }, (command, options) => (seen = { command, options }));

    const result = await runBuild(runner, { kind: 'dockerfile', dockerfile: 'Dockerfile' }, {
      image: 'app:1',
      cwd: 'repo',
      timeoutMs: 600_000,
    });

    expect(result.ok).toBe(true);
    expect(result.image).toBe('app:1');
    expect(result.command).toBe('docker build -t app:1 -f Dockerfile .');
    expect(seen?.options).toMatchObject({ cwd: 'repo', timeoutMs: 600_000 });
  });

  it('reports not-ok on a non-zero exit', async () => {
    const result = await runBuild(fakeRunner({ exitCode: 1, stderr: 'build failed' }), {
      kind: 'buildpack',
      language: 'node',
    }, { image: 'app:1' });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('reports not-ok on timeout', async () => {
    const result = await runBuild(fakeRunner({ exitCode: null, timedOut: true }), {
      kind: 'dockerfile',
    }, { image: 'app:1' });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });
});
