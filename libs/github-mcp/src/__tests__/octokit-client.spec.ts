import { OctokitGitHubClient, type OctokitLike, createOctokitGitHubClient } from '../octokit-client';

/** A jest-mock Octokit with sensible defaults; tests override per case. */
const makeOctokit = () => ({
  repos: {
    get: jest.fn(async () => ({ data: { default_branch: 'main' } })),
    getContent: jest.fn(async () => ({
      data: { type: 'file', content: Buffer.from('hello world').toString('base64'), encoding: 'base64', size: 11, path: 'a.txt' },
    })),
    getCommit: jest.fn(async () => ({ data: { sha: 'src-commit', commit: { tree: { sha: 'src-tree' } } } })),
  },
  git: {
    getRef: jest.fn(async () => ({ data: { object: { sha: 'base-commit' } } })),
    createRef: jest.fn(async () => ({ data: { ref: 'refs/heads/feature' } })),
    getCommit: jest.fn(async () => ({ data: { tree: { sha: 'base-tree' } } })),
    createTree: jest.fn(async () => ({ data: { sha: 'new-tree' } })),
    createCommit: jest.fn(async () => ({ data: { sha: 'new-commit' } })),
    updateRef: jest.fn(async () => ({ data: { object: { sha: 'new-commit' } } })),
    getTree: jest.fn(async () => ({
      data: { tree: [{ path: 'src/app.ts', type: 'blob', size: 12 }, { path: 'src', type: 'tree' }, { path: 'README.md', type: 'blob', size: 4 }] },
    })),
  },
  search: {
    code: jest.fn(async () => ({ data: { items: [{ path: 'src/x.ts', repository: { full_name: 'acme/app' }, html_url: 'https://gh/x' }] } })),
  },
  pulls: {
    create: jest.fn(async () => ({ data: { number: 42, html_url: 'https://gh/pr/42' } })),
    requestReviewers: jest.fn(async () => ({ data: {} })),
  },
  issues: {
    createComment: jest.fn(async () => ({ data: { id: 7, html_url: 'https://gh/c/7' } })),
  },
});

const clientOf = (octokit: ReturnType<typeof makeOctokit>) => new OctokitGitHubClient(octokit as unknown as OctokitLike);

describe('OctokitGitHubClient', () => {
  describe('read', () => {
    it('getFileContents decodes base64 content to UTF-8', async () => {
      const o = makeOctokit();
      const file = await clientOf(o).getFileContents({ owner: 'acme', repo: 'app', path: 'a.txt' });
      expect(file).toEqual({ path: 'a.txt', content: 'hello world', size: 11 });
      expect(o.repos.getContent).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', path: 'a.txt', ref: undefined });
    });

    it('getFileContents throws when the path is a directory', async () => {
      const o = makeOctokit();
      o.repos.getContent.mockResolvedValueOnce({ data: [{ type: 'file', path: 'a.txt', size: 1 }] } as never);
      await expect(clientOf(o).getFileContents({ owner: 'acme', repo: 'app', path: 'src' })).rejects.toThrow(/directory/);
    });

    it('getTree maps blob→file / tree→dir (recursive) and filters by path prefix', async () => {
      const o = makeOctokit();
      const entries = await clientOf(o).getTree({ owner: 'acme', repo: 'app', path: 'src', recursive: true });
      expect(o.git.getTree).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', tree_sha: 'src-tree', recursive: 'true' });
      expect(entries).toEqual([
        { path: 'src/app.ts', type: 'file', size: 12 },
        { path: 'src', type: 'dir' },
      ]); // README.md filtered out by the prefix
    });

    it('searchCode builds a repo-scoped query and maps matches', async () => {
      const o = makeOctokit();
      const matches = await clientOf(o).searchCode({ query: 'TODO', owner: 'acme', repo: 'app' });
      expect(o.search.code).toHaveBeenCalledWith({ q: 'TODO repo:acme/app' });
      expect(matches).toEqual([{ path: 'src/x.ts', repository: 'acme/app', url: 'https://gh/x' }]);
    });
  });

  describe('write', () => {
    it('createBranch resolves the default branch when no fromRef and creates the ref', async () => {
      const o = makeOctokit();
      const branch = await clientOf(o).createBranch({ owner: 'acme', repo: 'app', branch: 'feature' });
      expect(o.repos.get).toHaveBeenCalled(); // resolved the default branch
      expect(o.repos.getCommit).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', ref: 'main' });
      expect(o.git.createRef).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', ref: 'refs/heads/feature', sha: 'src-commit' });
      expect(branch).toEqual({ branch: 'feature', sha: 'src-commit' });
    });

    it('createBranch resolves an explicit fromRef without touching the default branch', async () => {
      const o = makeOctokit();
      await clientOf(o).createBranch({ owner: 'acme', repo: 'app', branch: 'hotfix', fromRef: 'release' });
      expect(o.repos.get).not.toHaveBeenCalled();
      expect(o.repos.getCommit).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', ref: 'release' });
    });

    it('commitFiles runs the Git Data API dance: base → tree (inline blobs) → commit → move ref', async () => {
      const o = makeOctokit();
      const result = await clientOf(o).commitFiles({
        owner: 'acme',
        repo: 'app',
        branch: 'feature',
        message: 'add files',
        files: [
          { path: 'src/a.ts', content: 'export const a = 1;' },
          { path: 'src/b.ts', content: 'export const b = 2;' },
        ],
      });

      expect(o.git.getRef).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', ref: 'heads/feature' });
      expect(o.git.getCommit).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', commit_sha: 'base-commit' });
      expect(o.git.createTree).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'app',
        base_tree: 'base-tree',
        tree: [
          { path: 'src/a.ts', mode: '100644', type: 'blob', content: 'export const a = 1;' },
          { path: 'src/b.ts', mode: '100644', type: 'blob', content: 'export const b = 2;' },
        ],
      });
      expect(o.git.createCommit).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', message: 'add files', tree: 'new-tree', parents: ['base-commit'] });
      expect(o.git.updateRef).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', ref: 'heads/feature', sha: 'new-commit' });
      expect(result).toEqual({ branch: 'feature', commitSha: 'new-commit' });
    });
  });

  describe('pull requests', () => {
    it('createPullRequest maps number + url', async () => {
      const o = makeOctokit();
      const pr = await clientOf(o).createPullRequest({ owner: 'acme', repo: 'app', head: 'feature', base: 'main', title: 'T', body: 'B' });
      expect(o.pulls.create).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', head: 'feature', base: 'main', title: 'T', body: 'B' });
      expect(pr).toEqual({ number: 42, url: 'https://gh/pr/42' });
    });

    it('commentOnPullRequest posts an issue comment and maps id + url', async () => {
      const o = makeOctokit();
      const comment = await clientOf(o).commentOnPullRequest({ owner: 'acme', repo: 'app', number: 42, body: 'nice' });
      expect(o.issues.createComment).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', issue_number: 42, body: 'nice' });
      expect(comment).toEqual({ id: 7, url: 'https://gh/c/7' });
    });

    it('requestReview asks for reviewers on the PR', async () => {
      const o = makeOctokit();
      await clientOf(o).requestReview({ owner: 'acme', repo: 'app', number: 42, reviewers: ['alice', 'bob'] });
      expect(o.pulls.requestReviewers).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', pull_number: 42, reviewers: ['alice', 'bob'] });
    });
  });

  it('createOctokitGitHubClient builds a working client', async () => {
    const o = makeOctokit();
    const client = createOctokitGitHubClient(o as unknown as OctokitLike);
    expect(await client.getFileContents({ owner: 'acme', repo: 'app', path: 'a.txt' })).toMatchObject({ content: 'hello world' });
  });
});
