import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import {
  EcrTarget,
  ecrImageUri,
  ecrLoginCommand,
  ecrPushCommands,
  ecrRegistry,
  pushImageToEcr,
} from '../ecr';

const target: EcrTarget = {
  accountId: '123456789012',
  region: 'eu-west-1',
  repository: 'helix/demo-app',
};

describe('ecrRegistry / ecrImageUri', () => {
  it('builds the registry host and image URI, defaulting the tag to latest', () => {
    expect(ecrRegistry(target)).toBe('123456789012.dkr.ecr.eu-west-1.amazonaws.com');
    expect(ecrImageUri(target)).toBe('123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest');
  });

  it('honours an explicit tag', () => {
    expect(ecrImageUri({ ...target, tag: 'v1.2.3' })).toBe(
      '123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:v1.2.3',
    );
  });

  it('rejects an invalid account id or empty fields', () => {
    expect(() => ecrRegistry({ ...target, accountId: 'nope' })).toThrow(/account id/);
    expect(() => ecrRegistry({ ...target, region: '  ' })).toThrow(/region/);
    expect(() => ecrRegistry({ ...target, repository: '' })).toThrow(/repository/);
  });
});

describe('ecrPushCommands', () => {
  it('produces login → tag → push, with the AWS login pipe and the URI', () => {
    expect(ecrPushCommands('app:local', target)).toEqual([
      {
        command: 'sh',
        args: [
          '-c',
          'aws ecr get-login-password --region eu-west-1 | ' +
            'docker login --username AWS --password-stdin 123456789012.dkr.ecr.eu-west-1.amazonaws.com',
        ],
      },
      {
        command: 'docker',
        args: ['tag', 'app:local', '123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest'],
      },
      {
        command: 'docker',
        args: ['push', '123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest'],
      },
    ]);
  });

  it('ecrLoginCommand uses the registry host and region', () => {
    expect(ecrLoginCommand(target).args[1]).toContain('--region eu-west-1');
    expect(ecrLoginCommand(target).args[1]).toContain('123456789012.dkr.ecr.eu-west-1.amazonaws.com');
  });
});

/** Runner that returns queued results in order, recording every call. */
function sequencedRunner(
  results: Partial<ExecResult>[],
  calls: { command: string; options?: RunOptions }[] = [],
): CommandRunner {
  let i = 0;
  return {
    async run(command: string, options: RunOptions = {}): Promise<ExecResult> {
      calls.push({ command, options });
      const result = results[i++] ?? {};
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

describe('pushImageToEcr', () => {
  it('runs login → tag → push and reports ok, passing cwd/timeout', async () => {
    const calls: { command: string; options?: RunOptions }[] = [];
    const runner = sequencedRunner([{}, {}, {}], calls);

    const result = await pushImageToEcr(runner, 'app:local', target, { cwd: 'repo', timeoutMs: 300_000 });

    expect(result.ok).toBe(true);
    expect(result.uri).toBe('123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest');
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(['sh', 'docker', 'docker']);
    expect(calls[2].options).toMatchObject({ cwd: 'repo', timeoutMs: 300_000 });
  });

  it('stops at the first failing step (login) and still reports the URI', async () => {
    const calls: { command: string; options?: RunOptions }[] = [];
    const runner = sequencedRunner([{ exitCode: 1, stderr: 'auth denied' }], calls);

    const result = await pushImageToEcr(runner, 'app:local', target);

    expect(result.ok).toBe(false);
    expect(result.uri).toBe('123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ ok: false, exitCode: 1, stderr: 'auth denied' });
    expect(calls).toHaveLength(1); // tag + push never ran
  });

  it('reports not-ok and stops when the push times out', async () => {
    const runner = sequencedRunner([{}, {}, { exitCode: null, timedOut: true }]);
    const result = await pushImageToEcr(runner, 'app:local', target);

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2]).toMatchObject({ ok: false, timedOut: true });
  });
});
