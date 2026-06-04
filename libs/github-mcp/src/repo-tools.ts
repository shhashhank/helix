/**
 * GitHub repo read/search MCP tools (HELIX-86): read a file, list the tree, and
 * search code. Registered on an MCP server and backed by an injected
 * {@link GitHubClient}. Expected failures (e.g. a missing file) come back as a
 * tool error (`isError: true`) rather than throwing.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitHubClient } from './github-client';
import { errorResult, textResult } from './tool-result';

/** Register `github_get_file`, `github_get_tree`, and `github_search_code`. */
export function registerRepoReadTools(server: McpServer, github: GitHubClient): void {
  server.registerTool(
    'github_get_file',
    {
      description: 'Read a file from a GitHub repository.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        ref: z.string().optional(),
      },
    },
    async ({ owner, repo, path, ref }) => {
      try {
        const file = await github.getFileContents({ owner, repo, path, ref });
        return textResult(file.content);
      } catch (err) {
        return errorResult(`reading ${path}`, err);
      }
    },
  );

  server.registerTool(
    'github_get_tree',
    {
      description: 'List files and directories in a GitHub repository (optionally under a path).',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        path: z.string().optional(),
        ref: z.string().optional(),
        recursive: z.boolean().optional(),
      },
    },
    async ({ owner, repo, path, ref, recursive }) => {
      try {
        const entries = await github.getTree({ owner, repo, path, ref, recursive });
        return textResult(JSON.stringify(entries, null, 2));
      } catch (err) {
        return errorResult('listing tree', err);
      }
    },
  );

  server.registerTool(
    'github_search_code',
    {
      description: 'Search code across GitHub (optionally scoped to an owner/repo).',
      inputSchema: {
        query: z.string(),
        owner: z.string().optional(),
        repo: z.string().optional(),
      },
    },
    async ({ query, owner, repo }) => {
      try {
        const matches = await github.searchCode({ query, owner, repo });
        return textResult(JSON.stringify(matches, null, 2));
      } catch (err) {
        return errorResult('searching code', err);
      }
    },
  );
}
