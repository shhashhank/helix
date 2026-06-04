/**
 * GitHub pull-request MCP tools (HELIX-88): open a PR, comment on it, and request
 * reviews — the final GitHub abilities a coding agent needs to ship work. Built on
 * the same {@link GitHubClient} seam (stub-testable; real client in HELIX-89);
 * expected failures come back as tool errors.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitHubClient } from './github-client';
import { errorResult, textResult } from './tool-result';

/** Register `github_create_pull_request`, `github_comment_on_pull_request`, `github_request_review`. */
export function registerPrTools(server: McpServer, github: GitHubClient): void {
  server.registerTool(
    'github_create_pull_request',
    {
      description: 'Open a pull request from a head branch into a base branch.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        head: z.string(),
        base: z.string(),
        title: z.string(),
        body: z.string().optional(),
      },
    },
    async ({ owner, repo, head, base, title, body }) => {
      try {
        const pr = await github.createPullRequest({ owner, repo, head, base, title, body });
        return textResult(`opened PR #${pr.number}: ${pr.url}`);
      } catch (err) {
        return errorResult('creating pull request', err);
      }
    },
  );

  server.registerTool(
    'github_comment_on_pull_request',
    {
      description: 'Post a comment on a pull request.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        number: z.number().int().positive(),
        body: z.string(),
      },
    },
    async ({ owner, repo, number, body }) => {
      try {
        const comment = await github.commentOnPullRequest({ owner, repo, number, body });
        return textResult(`commented on PR #${number}: ${comment.url}`);
      } catch (err) {
        return errorResult(`commenting on PR #${number}`, err);
      }
    },
  );

  server.registerTool(
    'github_request_review',
    {
      description: 'Request reviews on a pull request from one or more users.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        number: z.number().int().positive(),
        reviewers: z.array(z.string()).min(1),
      },
    },
    async ({ owner, repo, number, reviewers }) => {
      try {
        await github.requestReview({ owner, repo, number, reviewers });
        return textResult(`requested review on PR #${number} from ${reviewers.join(', ')}`);
      } catch (err) {
        return errorResult(`requesting review on PR #${number}`, err);
      }
    },
  );
}
