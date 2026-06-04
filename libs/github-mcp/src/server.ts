/**
 * GitHub MCP server (HELIX-24). Builds an MCP server exposing GitHub tools to the
 * agents, backed by an injected {@link GitHubClient}. HELIX-86 registers the
 * repo read/search tools; branch/commit/push (HELIX-87) and PR/review (HELIX-88)
 * tools register onto the same server next, and the real authenticated client
 * arrives with HELIX-89.
 *
 * Run it over stdio (a thin `StdioServerTransport` wrapper) so the MCP server
 * registry can launch and connect to it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitHubClient } from './github-client';
import { registerRepoReadTools } from './repo-tools';
import { registerRepoWriteTools } from './write-tools';

export interface GitHubMcpServerOptions {
  name?: string;
  version?: string;
}

/** Create a GitHub MCP server with the repo read/search + write tools registered. */
export function createGitHubMcpServer(
  github: GitHubClient,
  opts: GitHubMcpServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'helix-github',
    version: opts.version ?? '0.1.0',
  });
  registerRepoReadTools(server, github);
  registerRepoWriteTools(server, github);
  return server;
}
