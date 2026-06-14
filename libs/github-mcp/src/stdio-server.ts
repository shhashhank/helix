/**
 * Runnable stdio entrypoint for the GitHub MCP server (HELIX-169, DEFERRED #1).
 *
 * This is the composition root that makes the server **live**: it reads the GitHub App
 * credentials from the environment, builds a real Octokit authenticated with a
 * short-lived installation token (refreshed per request by {@link GitHubAppTokenProvider}),
 * wraps it in the {@link OctokitGitHubClient} (HELIX-168), and serves the MCP tools over
 * **stdio** so the MCP server registry can launch and connect to it.
 *
 * Run it (App creds in env; never commit them):
 *   GITHUB_APP_ID=… GITHUB_APP_INSTALLATION_ID=… GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" \
 *     pnpm github-mcp:stdio
 *
 * Octokit (`@octokit/rest`) is **ESM-only**, so it's loaded with a dynamic `import()` —
 * keeping the rest of the lib CJS/Jest-friendly (the lib itself never imports Octokit;
 * the client takes an injected {@link OctokitLike}). MCP messages are JSON-RPC on stdout,
 * so all logging goes to **stderr**.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type GitHubAppTokenProvider, appTokenProviderFromEnv } from './app-auth';
import { type OctokitLike, createOctokitGitHubClient } from './octokit-client';
import { createGitHubMcpServer } from './server';

/** Build the Octokit REST surface, auto-injecting a fresh installation token per request. */
async function createAuthedOctokitRest(provider: GitHubAppTokenProvider): Promise<OctokitLike> {
  const { Octokit } = await import('@octokit/rest'); // ESM-only — dynamic import keeps the lib CJS-runnable
  const octokit = new Octokit();
  octokit.hook.before('request', async (options) => {
    options.headers.authorization = `token ${await provider.getToken()}`;
  });
  return octokit.rest as unknown as OctokitLike;
}

async function main(): Promise<void> {
  const provider = appTokenProviderFromEnv(); // throws a clear error if any App credential is missing
  const github = createOctokitGitHubClient(await createAuthedOctokitRest(provider));
  const server = createGitHubMcpServer(github, { name: 'helix-github', version: '0.1.0' });

  await server.connect(new StdioServerTransport());
  process.stderr.write('[github-mcp] stdio server ready — serving GitHub tools over stdio\n');
}

void main().catch((err) => {
  process.stderr.write(`[github-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
