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

/** The GitHub read/search operations the tools need. */
export interface GitHubClient {
  getFileContents(args: RepoRef & { path: string }): Promise<FileContents>;
  getTree(args: RepoRef & { path?: string; recursive?: boolean }): Promise<TreeEntry[]>;
  searchCode(args: { query: string; owner?: string; repo?: string }): Promise<CodeSearchMatch[]>;
}
