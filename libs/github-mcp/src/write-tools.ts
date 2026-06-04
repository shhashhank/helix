/**
 * GitHub repo write MCP tools (HELIX-87): create a branch and commit files (push).
 * Registered on the GitHub MCP server and backed by the same injected
 * {@link GitHubClient}. These mutate the repo, so in production they run with a
 * short-lived, repo-scoped GitHub App token (HELIX-89) and are typically gated by
 * the tool policy / approval layer. Expected failures come back as tool errors.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitHubClient } from './github-client';
import { errorResult, textResult } from './tool-result';

/** Register `github_create_branch` and `github_commit_files`. */
export function registerRepoWriteTools(server: McpServer, github: GitHubClient): void {
  server.registerTool(
    'github_create_branch',
    {
      description: 'Create a new branch in a GitHub repository (from a base ref or the default branch).',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        branch: z.string(),
        fromRef: z.string().optional(),
      },
    },
    async ({ owner, repo, branch, fromRef }) => {
      try {
        const created = await github.createBranch({ owner, repo, branch, fromRef });
        return textResult(`created branch "${created.branch}" at ${created.sha}`);
      } catch (err) {
        return errorResult(`creating branch ${branch}`, err);
      }
    },
  );

  server.registerTool(
    'github_commit_files',
    {
      description: 'Create a commit on a branch that adds or updates one or more files.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        branch: z.string(),
        message: z.string(),
        files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
      },
    },
    async ({ owner, repo, branch, message, files }) => {
      try {
        const result = await github.commitFiles({ owner, repo, branch, message, files });
        return textResult(`committed ${files.length} file(s) to "${result.branch}" (${result.commitSha})`);
      } catch (err) {
        return errorResult('committing files', err);
      }
    },
  );
}
