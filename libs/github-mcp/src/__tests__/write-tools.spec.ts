import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GitHubClient } from '../github-client';
import { createGitHubMcpServer } from '../server';

function stubClient(over: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getFileContents: async ({ path }) => ({ path, content: '', size: 0 }),
    getTree: async () => [],
    searchCode: async () => [],
    createBranch: async ({ branch }) => ({ branch, sha: 'abc123' }),
    commitFiles: async ({ branch }) => ({ branch, commitSha: 'def456' }),
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

describe('GitHub MCP server — repo write tools', () => {
  it('advertises the write tools alongside the read tools', async () => {
    const client = await connect(stubClient());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['github_create_branch', 'github_commit_files']));
  });

  it('github_create_branch creates a branch and reports the SHA', async () => {
    let received: unknown;
    const client = await connect(
      stubClient({
        createBranch: async (args) => {
          received = args;
          return { branch: args.branch, sha: 'newsha' };
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_create_branch',
      arguments: { owner: 'o', repo: 'r', branch: 'feature/x', fromRef: 'main' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('feature/x');
    expect(JSON.stringify(res.content)).toContain('newsha');
    expect(received).toMatchObject({ owner: 'o', repo: 'r', branch: 'feature/x', fromRef: 'main' });
  });

  it('github_commit_files commits the given files and reports the commit', async () => {
    let received: { files: unknown[] } | undefined;
    const client = await connect(
      stubClient({
        commitFiles: async (args) => {
          received = args;
          return { branch: args.branch, commitSha: 'c0ffee' };
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_commit_files',
      arguments: {
        owner: 'o',
        repo: 'r',
        branch: 'feature/x',
        message: 'add files',
        files: [
          { path: 'a.ts', content: 'export const a = 1;' },
          { path: 'b.ts', content: 'export const b = 2;' },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('c0ffee');
    expect(JSON.stringify(res.content)).toContain('2 file(s)');
    expect(received?.files).toHaveLength(2);
  });

  it('surfaces a write failure as a tool error (isError)', async () => {
    const client = await connect(
      stubClient({
        createBranch: async () => {
          throw new Error('branch already exists');
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_create_branch',
      arguments: { owner: 'o', repo: 'r', branch: 'dup' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('branch already exists');
  });
});
