import type { GitHubClient } from '@helix/github-mcp';
import type { ExecutableStep, RunContext } from '@helix/executor';
import { deliveryTargetFromConfig, sandboxDeliveryRunner, type RunChangeSet } from '../lib/delivery-runner';

const ctx: RunContext = { results: {}, runId: 'run-42' };
const stepWith = (delivery?: unknown): ExecutableStep => ({ id: 'deliver', agentRole: 'delivery', config: delivery ? { delivery } : undefined });
const target = { owner: 'acme', repo: 'app', base: 'main', installationId: 'inst-1' };

const fakeClient = () =>
  ({
    createBranch: jest.fn(async () => ({ branch: 'helix/run-42', sha: 'base' })),
    commitFiles: jest.fn(async () => ({ branch: 'helix/run-42', commitSha: 'c0ffee' })),
    createPullRequest: jest.fn(async () => ({ number: 5, url: 'https://github.com/acme/app/pull/5' })),
  }) as unknown as GitHubClient;

const changeSet: RunChangeSet = { files: [{ path: 'src/a.ts', content: 'x' }], summary: { filesChanged: 1, additions: 1, deletions: 0 } };

describe('sandboxDeliveryRunner', () => {
  it('opens a PR for the run’s change-set against the configured repo', async () => {
    const client = fakeClient();
    const runner = sandboxDeliveryRunner({
      changeSet: async () => changeSet,
      createClient: async () => client,
    });

    const outcome = await runner.deliver({ step: stepWith(target), ctx });

    expect(outcome).toEqual({ delivered: true, pullRequest: { number: 5, url: 'https://github.com/acme/app/pull/5' }, changeSet: changeSet.summary });
    expect(client.createBranch).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'app', branch: 'helix/run-42' }));
    expect(client.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'app', head: 'helix/run-42', base: 'main' }));
  });

  it('skips (benign) when no delivery target is configured', async () => {
    const runner = sandboxDeliveryRunner({ changeSet: async () => changeSet, createClient: async () => fakeClient() });
    expect(await runner.deliver({ step: stepWith(undefined), ctx })).toEqual({ delivered: false, skippedReason: 'no delivery target configured' });
  });

  it('skips when no GitHub App is configured (no client factory)', async () => {
    const runner = sandboxDeliveryRunner({ changeSet: async () => changeSet });
    expect(await runner.deliver({ step: stepWith(target), ctx })).toEqual({ delivered: false, skippedReason: 'GitHub App not configured' });
  });

  it('skips when there is nothing to deliver, still surfacing the (empty) change-set', async () => {
    const empty: RunChangeSet = { files: [], summary: { filesChanged: 0, additions: 0, deletions: 0 } };
    const runner = sandboxDeliveryRunner({ changeSet: async () => empty, createClient: async () => fakeClient() });
    expect(await runner.deliver({ step: stepWith(target), ctx })).toEqual({ delivered: false, skippedReason: 'no changes to deliver', changeSet: empty.summary });
  });

  it('maps a GitHub failure to an error outcome (the step fails)', async () => {
    const client = fakeClient();
    (client.createPullRequest as jest.Mock).mockRejectedValueOnce(new Error('422 PR already exists'));
    const runner = sandboxDeliveryRunner({ changeSet: async () => changeSet, createClient: async () => client });
    expect(await runner.deliver({ step: stepWith(target), ctx })).toEqual({ delivered: false, error: '422 PR already exists', changeSet: changeSet.summary });
  });

  describe('deliveryTargetFromConfig', () => {
    it('reads a valid target from step.config.delivery', () => {
      expect(deliveryTargetFromConfig(stepWith(target))).toEqual(target);
    });
    it('returns undefined for missing/invalid config', () => {
      expect(deliveryTargetFromConfig(stepWith(undefined))).toBeUndefined();
      expect(deliveryTargetFromConfig(stepWith({ owner: 'acme' }))).toBeUndefined(); // no repo / installationId
    });
  });
});
