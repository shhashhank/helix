/**
 * GitHub access seam for the GitHub MCP server (HELIX-86). The tools are written
 * against this interface so they're unit-testable with a stub; the real
 * Octokit-backed client (authenticated with short-lived GitHub App installation
 * tokens) arrives in HELIX-89.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag, or commit SHA. Defaults to the repo's default branch. */
  ref?: string;
}

export interface FileContents {
  path: string;
  /** Decoded UTF-8 text. */
  content: string;
  size: number;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  /** Size in bytes (files only). */
  size?: number;
}

export interface CodeSearchMatch {
  path: string;
  /** `owner/repo` the match is in. */
  repository: string;
  url?: string;
}

export interface CreatedBranch {
  branch: string;
  /** Commit SHA the new branch points at. */
  sha: string;
}

/** A file to write in a commit. */
export interface CommitFile {
  path: string;
  /** New UTF-8 file content. */
  content: string;
}

export interface CommitResult {
  branch: string;
  commitSha: string;
}

export interface PullRequest {
  number: number;
  url: string;
}

export interface PrComment {
  id: number;
  url: string;
}

/** The GitHub read/search + write + pull-request operations the tools need. */
export interface GitHubClient {
  // Read (HELIX-86)
  getFileContents(args: RepoRef & { path: string }): Promise<FileContents>;
  getTree(args: RepoRef & { path?: string; recursive?: boolean }): Promise<TreeEntry[]>;
  searchCode(args: { query: string; owner?: string; repo?: string }): Promise<CodeSearchMatch[]>;

  // Write (HELIX-87)
  /** Create a branch from `fromRef` (default: the repo's default branch). */
  createBranch(args: { owner: string; repo: string; branch: string; fromRef?: string }): Promise<CreatedBranch>;
  /** Create a single commit on `branch` that adds/updates `files`. */
  commitFiles(args: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: CommitFile[];
  }): Promise<CommitResult>;

  // Pull requests (HELIX-88)
  /** Open a pull request from `head` into `base`. */
  createPullRequest(args: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body?: string;
  }): Promise<PullRequest>;
  /** Post a comment on a pull request (or issue). */
  commentOnPullRequest(args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
  }): Promise<PrComment>;
  /** Request reviews on a pull request from the given users. */
  requestReview(args: {
    owner: string;
    repo: string;
    number: number;
    reviewers: string[];
  }): Promise<void>;
}
