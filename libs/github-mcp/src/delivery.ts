/**
 * Deliver a change-set as a pull request (HELIX-182).
 *
 * Composes the {@link GitHubClient} seam into the one operation a run needs at the end:
 * take the files the coding agent changed, push them onto a fresh branch off `base`, and
 * open a PR. Pure over the seam — unit-tested with a stub; the real {@link OctokitGitHubClient}
 * (HELIX-168) makes it live. The worker wires this onto a run's sandbox change-set
 * (HELIX-184/186).
 */
import type { CommitFile, GitHubClient } from './github-client';

export interface DeliverChangeSetInput {
  client: GitHubClient;
  owner: string;
  repo: string;
  /** Branch to push the changes onto (also the PR head). */
  branch: string;
  /** Base branch to branch from + target the PR at (default `main`). */
  base?: string;
  /** Commit message. */
  message: string;
  /** Files to add/update — path + full new content. Must be non-empty. */
  files: CommitFile[];
  /** Pull-request title + body. */
  title: string;
  body?: string;
}

export interface DeliveredPullRequest {
  number: number;
  url: string;
  branch: string;
  base: string;
  commitSha: string;
}

/**
 * Create `branch` from `base`, commit `files` onto it, and open a PR `branch → base`.
 * Throws if there's nothing to deliver. (Deletions aren't committed yet — the underlying
 * `commitFiles` adds/updates via inline content; removing files is a follow-up.)
 */
export async function deliverChangeSet(input: DeliverChangeSetInput): Promise<DeliveredPullRequest> {
  const { client, owner, repo, branch, message, files, title, body } = input;
  const base = input.base ?? 'main';
  if (files.length === 0) {
    throw new Error('deliverChangeSet: no files to deliver');
  }

  await client.createBranch({ owner, repo, branch, fromRef: base });
  const { commitSha } = await client.commitFiles({ owner, repo, branch, message, files });
  const pr = await client.createPullRequest({ owner, repo, head: branch, base, title, body });

  return { number: pr.number, url: pr.url, branch, base, commitSha };
}
