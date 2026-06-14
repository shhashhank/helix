import type { GitHubClient } from '../github-client';
import { deliverChangeSet } from '../delivery';

const makeClient = () => ({
  createBranch: jest.fn(async () => ({ branch: 'helix/run-1', sha: 'base-sha' })),
  commitFiles: jest.fn(async () => ({ branch: 'helix/run-1', commitSha: 'commit-sha' })),
  createPullRequest: jest.fn(async () => ({ number: 7, url: 'https://gh/pr/7' })),
});
const asClient = (c: ReturnType<typeof makeClient>) => c as unknown as GitHubClient;

describe('deliverChangeSet', () => {
  const files = [{ path: 'src/a.ts', content: 'export const a = 1;' }];

  it('branches from base, commits the files, and opens a PR — returning the PR', async () => {
    const c = makeClient();
    const pr = await deliverChangeSet({
      client: asClient(c),
      owner: 'acme',
      repo: 'app',
      branch: 'helix/run-1',
      base: 'develop',
      message: 'apply run output',
      files,
      title: 'Helix: run-1',
      body: 'automated',
    });

    expect(c.createBranch).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', branch: 'helix/run-1', fromRef: 'develop' });
    expect(c.commitFiles).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', branch: 'helix/run-1', message: 'apply run output', files });
    expect(c.createPullRequest).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', head: 'helix/run-1', base: 'develop', title: 'Helix: run-1', body: 'automated' });
    expect(pr).toEqual({ number: 7, url: 'https://gh/pr/7', branch: 'helix/run-1', base: 'develop', commitSha: 'commit-sha' });
  });

  it('defaults the base branch to main', async () => {
    const c = makeClient();
    await deliverChangeSet({ client: asClient(c), owner: 'acme', repo: 'app', branch: 'b', message: 'm', files, title: 'T' });
    expect(c.createBranch).toHaveBeenCalledWith(expect.objectContaining({ fromRef: 'main' }));
    expect(c.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ base: 'main' }));
  });

  it('throws when there are no files to deliver (no empty PR)', async () => {
    const c = makeClient();
    await expect(
      deliverChangeSet({ client: asClient(c), owner: 'acme', repo: 'app', branch: 'b', message: 'm', files: [], title: 'T' }),
    ).rejects.toThrow(/no files to deliver/);
    expect(c.createBranch).not.toHaveBeenCalled();
  });
});
