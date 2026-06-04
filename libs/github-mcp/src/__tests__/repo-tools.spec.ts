import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GitHubClient } from '../github-client';
import { createGitHubMcpServer } from '../server';

function stubClient(over: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getFileContents: async ({ path }) => ({ path, content: `contents of ${path}`, size: 12 }),
    getTree: async () => [
      { path: 'src', type: 'dir' },
      { path: 'README.md', type: 'file', size: 42 },
    ],
    searchCode: async ({ query }) => [{ path: `match-for-${query}.ts`, repository: 'o/r' }],
    createBranch: async ({ branch }) => ({ branch, sha: 'sha0' }),
    commitFiles: async ({ branch }) => ({ branch, commitSha: 'commit0' }),
    ...over,
  };
}

/** Connect a raw MCP client to a GitHub MCP server over an in-memory transport. */
async function connect(github: GitHubClient): Promise<Client> {
  const server = createGitHubMcpServer(github);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('GitHub MCP server — repo read/search tools', () => {
  it('advertises the read/search tools', async () => {
    const client = await connect(stubClient());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['github_get_file', 'github_get_tree', 'github_search_code']),
    );
  });

  it('github_get_file returns the file contents', async () => {
    const client = await connect(stubClient());
    const res = await client.callTool({
      name: 'github_get_file',
      arguments: { owner: 'o', repo: 'r', path: 'src/x.ts' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('contents of src/x.ts');
  });

  it('github_get_tree lists entries', async () => {
    const client = await connect(stubClient());
    const res = await client.callTool({ name: 'github_get_tree', arguments: { owner: 'o', repo: 'r' } });
    const text = JSON.stringify(res.content);
    expect(text).toContain('README.md');
    expect(text).toContain('dir'); // the `src` entry's type
  });

  it('github_search_code returns matches', async () => {
    const client = await connect(stubClient());
    const res = await client.callTool({
      name: 'github_search_code',
      arguments: { query: 'TODO', owner: 'o', repo: 'r' },
    });
    expect(JSON.stringify(res.content)).toContain('match-for-TODO.ts');
  });

  it('surfaces a backend failure as a tool error (isError)', async () => {
    const client = await connect(
      stubClient({
        getFileContents: async () => {
          throw new Error('404 not found');
        },
      }),
    );
    const res = await client.callTool({
      name: 'github_get_file',
      arguments: { owner: 'o', repo: 'r', path: 'missing.ts' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('404 not found');
  });
});
