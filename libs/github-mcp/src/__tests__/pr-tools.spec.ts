import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GitHubClient } from '../github-client';
import { createGitHubMcpServer } from '../server';

function stubClient(over: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getFileContents: async ({ path }) => ({ path, content: '', size: 0 }),
    getTree: async () => [],
    searchCode: async () => [],
    createBranch: async ({ branch }) => ({ branch, sha: 'sha' }),
    commitFiles: async ({ branch }) => ({ branch, commitSha: 'commit' }),
    createPullRequest: async () => ({ number: 7, url: 'https://github.com/o/r/pull/7' }),
    commentOnPullRequest: async () => ({ id: 100, url: 'https://github.com/o/r/pull/7#issuecomment-100' }),
    requestReview: async () => undefined,
    ...over,
  };
}

async function connect(github: GitHubClient): Promise<Client> {
  const server = createGitHubMcpServer(github);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('GitHub MCP server — pull request tools', () => {
  it('advertises the PR tools', async () => {
    const client = await connect(stubClient());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'github_create_pull_request',
        'github_comment_on_pull_request',
        'github_request_review',
      ]),
    );
  });

  it('github_create_pull_request opens a PR and reports the number + url', async () => {
    let received: unknown;
    const client = await connect(
      stubClient({
        createPullRequest: async (args) => {
          received = args;
          return { number: 42, url: 'https://github.com/o/r/pull/42' };
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_create_pull_request',
      arguments: { owner: 'o', repo: 'r', head: 'feature/x', base: 'main', title: 'Add x', body: 'why' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('#42');
    expect(JSON.stringify(res.content)).toContain('pull/42');
    expect(received).toMatchObject({ head: 'feature/x', base: 'main', title: 'Add x', body: 'why' });
  });

  it('github_comment_on_pull_request posts a comment', async () => {
    const client = await connect(stubClient());
    const res = await client.callTool({
      name: 'github_comment_on_pull_request',
      arguments: { owner: 'o', repo: 'r', number: 7, body: 'looks good' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('#7');
  });

  it('github_request_review requests the given reviewers', async () => {
    let received: { reviewers: string[] } | undefined;
    const client = await connect(
      stubClient({
        requestReview: async (args) => {
          received = args;
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_request_review',
      arguments: { owner: 'o', repo: 'r', number: 7, reviewers: ['alice', 'bob'] },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('alice, bob');
    expect(received?.reviewers).toEqual(['alice', 'bob']);
  });

  it('surfaces a PR failure as a tool error (isError)', async () => {
    const client = await connect(
      stubClient({
        createPullRequest: async () => {
          throw new Error('a pull request already exists for feature/x');
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_create_pull_request',
      arguments: { owner: 'o', repo: 'r', head: 'feature/x', base: 'main', title: 'dup' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('already exists');
  });
});
