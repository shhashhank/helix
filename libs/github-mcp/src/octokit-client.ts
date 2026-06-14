/**
 * Real Octokit-backed {@link GitHubClient} (HELIX-168, DEFERRED #1).
 *
 * The GitHub tools were built against the `GitHubClient` seam and stub-tested
 * (HELIX-86/87/88); this is the concrete client that makes real GitHub calls. To keep
 * this lib **CJS/Jest-friendly and mock-testable**, it does NOT import Octokit (which is
 * ESM-only) — instead it depends on a narrow injected {@link OctokitLike} interface
 * covering exactly the REST calls it uses. The real `Octokit` (authenticated with a
 * short-lived App installation token, HELIX-89) is constructed at the composition root
 * — the stdio server entry / worker (HELIX-169) — and passed in here.
 *
 * The fiddly part is {@link OctokitGitHubClient.commitFiles}: a single atomic commit of
 * many files via the Git Data API — base commit → base tree → new tree (inline blobs) →
 * new commit → move the branch ref.
 */
import type {
  CodeSearchMatch,
  CommitResult,
  CreatedBranch,
  FileContents,
  GitHubClient,
  PrComment,
  PullRequest,
  RepoRef,
  TreeEntry,
} from './github-client';
import type { CommitFile } from './github-client';

/**
 * The slice of Octokit's REST surface {@link OctokitGitHubClient} uses — typed to the
 * exact args sent and `.data` fields read, so a test can hand-roll a tiny mock. The real
 * `Octokit` (`@octokit/rest`) is structurally compatible.
 */
export interface OctokitLike {
  repos: {
    get(args: { owner: string; repo: string }): Promise<{ data: { default_branch: string } }>;
    getContent(args: { owner: string; repo: string; path: string; ref?: string }): Promise<{
      data:
        | { type: string; content?: string; encoding?: string; size: number; path: string }
        | Array<{ type: string; path: string; size?: number }>;
    }>;
    getCommit(args: { owner: string; repo: string; ref: string }): Promise<{
      data: { sha: string; commit: { tree: { sha: string } } };
    }>;
  };
  git: {
    getRef(args: { owner: string; repo: string; ref: string }): Promise<{ data: { object: { sha: string } } }>;
    createRef(args: { owner: string; repo: string; ref: string; sha: string }): Promise<{ data: { ref: string } }>;
    getCommit(args: { owner: string; repo: string; commit_sha: string }): Promise<{ data: { tree: { sha: string } } }>;
    createTree(args: {
      owner: string;
      repo: string;
      base_tree?: string;
      tree: Array<{ path: string; mode: string; type: string; content?: string }>;
    }): Promise<{ data: { sha: string } }>;
    createCommit(args: {
      owner: string;
      repo: string;
      message: string;
      tree: string;
      parents: string[];
    }): Promise<{ data: { sha: string } }>;
    updateRef(args: { owner: string; repo: string; ref: string; sha: string }): Promise<{ data: { object: { sha: string } } }>;
    getTree(args: { owner: string; repo: string; tree_sha: string; recursive?: string }): Promise<{
      data: { tree: Array<{ path?: string; type?: string; size?: number }> };
    }>;
  };
  search: {
    code(args: { q: string }): Promise<{
      data: { items: Array<{ path: string; repository: { full_name: string }; html_url?: string }> };
    }>;
  };
  pulls: {
    create(args: {
      owner: string;
      repo: string;
      head: string;
      base: string;
      title: string;
      body?: string;
    }): Promise<{ data: { number: number; html_url: string } }>;
    requestReviewers(args: { owner: string; repo: string; pull_number: number; reviewers: string[] }): Promise<unknown>;
  };
  issues: {
    createComment(args: { owner: string; repo: string; issue_number: number; body: string }): Promise<{
      data: { id: number; html_url: string };
    }>;
  };
}

/** `GitHubClient` backed by a real (injected) Octokit. */
export class OctokitGitHubClient implements GitHubClient {
  constructor(private readonly octokit: OctokitLike) {}

  /** Resolve a ref (branch/tag/sha; default = the repo's default branch) to its commit + tree SHA. */
  private async resolveCommit(args: { owner: string; repo: string; ref?: string }): Promise<{ commitSha: string; treeSha: string }> {
    const ref = args.ref ?? (await this.octokit.repos.get({ owner: args.owner, repo: args.repo })).data.default_branch;
    const { data } = await this.octokit.repos.getCommit({ owner: args.owner, repo: args.repo, ref });
    return { commitSha: data.sha, treeSha: data.commit.tree.sha };
  }

  async getFileContents(args: RepoRef & { path: string }): Promise<FileContents> {
    const { data } = await this.octokit.repos.getContent({ owner: args.owner, repo: args.repo, path: args.path, ref: args.ref });
    if (Array.isArray(data)) throw new Error(`path "${args.path}" is a directory, not a file`);
    if (data.type !== 'file' || data.content === undefined) throw new Error(`path "${args.path}" is not a readable file`);
    const content = Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8');
    return { path: data.path, content, size: data.size };
  }

  async getTree(args: RepoRef & { path?: string; recursive?: boolean }): Promise<TreeEntry[]> {
    const { treeSha } = await this.resolveCommit({ owner: args.owner, repo: args.repo, ref: args.ref });
    const { data } = await this.octokit.git.getTree({
      owner: args.owner,
      repo: args.repo,
      tree_sha: treeSha,
      recursive: args.recursive ? 'true' : undefined,
    });
    const prefix = args.path ? (args.path.endsWith('/') ? args.path : `${args.path}/`) : undefined;
    return data.tree
      .filter((e) => typeof e.path === 'string')
      .filter((e) => !prefix || e.path === args.path || (e.path as string).startsWith(prefix))
      .map((e) => {
        const entry: TreeEntry = { path: e.path as string, type: e.type === 'tree' ? 'dir' : 'file' };
        if (e.size !== undefined) entry.size = e.size;
        return entry;
      });
  }

  async searchCode(args: { query: string; owner?: string; repo?: string }): Promise<CodeSearchMatch[]> {
    const scope = args.owner && args.repo ? `repo:${args.owner}/${args.repo}` : args.owner ? `user:${args.owner}` : undefined;
    const q = [args.query, scope].filter(Boolean).join(' ');
    const { data } = await this.octokit.search.code({ q });
    return data.items.map((i) => ({ path: i.path, repository: i.repository.full_name, url: i.html_url }));
  }

  async createBranch(args: { owner: string; repo: string; branch: string; fromRef?: string }): Promise<CreatedBranch> {
    const { commitSha } = await this.resolveCommit({ owner: args.owner, repo: args.repo, ref: args.fromRef });
    await this.octokit.git.createRef({ owner: args.owner, repo: args.repo, ref: `refs/heads/${args.branch}`, sha: commitSha });
    return { branch: args.branch, sha: commitSha };
  }

  async commitFiles(args: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: CommitFile[];
  }): Promise<CommitResult> {
    const headRef = `heads/${args.branch}`;
    // 1. the branch's current commit → 2. its tree
    const baseCommitSha = (await this.octokit.git.getRef({ owner: args.owner, repo: args.repo, ref: headRef })).data.object.sha;
    const baseTreeSha = (await this.octokit.git.getCommit({ owner: args.owner, repo: args.repo, commit_sha: baseCommitSha })).data.tree.sha;
    // 3. new tree over the base, with each file as an inline blob
    const tree = args.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }));
    const newTreeSha = (await this.octokit.git.createTree({ owner: args.owner, repo: args.repo, base_tree: baseTreeSha, tree })).data.sha;
    // 4. commit it → 5. move the branch ref
    const newCommitSha = (
      await this.octokit.git.createCommit({ owner: args.owner, repo: args.repo, message: args.message, tree: newTreeSha, parents: [baseCommitSha] })
    ).data.sha;
    await this.octokit.git.updateRef({ owner: args.owner, repo: args.repo, ref: headRef, sha: newCommitSha });
    return { branch: args.branch, commitSha: newCommitSha };
  }

  async createPullRequest(args: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body?: string;
  }): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.create({
      owner: args.owner,
      repo: args.repo,
      head: args.head,
      base: args.base,
      title: args.title,
      body: args.body,
    });
    return { number: data.number, url: data.html_url };
  }

  async commentOnPullRequest(args: { owner: string; repo: string; number: number; body: string }): Promise<PrComment> {
    const { data } = await this.octokit.issues.createComment({ owner: args.owner, repo: args.repo, issue_number: args.number, body: args.body });
    return { id: data.id, url: data.html_url };
  }

  async requestReview(args: { owner: string; repo: string; number: number; reviewers: string[] }): Promise<void> {
    await this.octokit.pulls.requestReviewers({ owner: args.owner, repo: args.repo, pull_number: args.number, reviewers: args.reviewers });
  }
}

/** Build a {@link GitHubClient} from a real (or mock) Octokit. */
export const createOctokitGitHubClient = (octokit: OctokitLike): GitHubClient => new OctokitGitHubClient(octokit);
