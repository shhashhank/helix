/**
 * Repo checkout + workspace mount (HELIX-101): materialize a target repo/branch
 * into a {@link Sandbox} so the coding agent has the code to edit.
 *
 * *Where* the files come from is an injected {@link RepoFetcher} seam — the real
 * one shells out to `git clone` (or reads via the GitHub tools); an
 * {@link InMemoryRepoFetcher} backs tests and composition. This module owns the
 * *mounting*: writing each file into the workspace through the sandbox's
 * path-escape guard, so a hostile repo path can't write outside the sandbox.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Sandbox } from './sandbox';

/** Identifies a repo + the ref to check out. */
export interface RepoRef {
  owner?: string;
  repo: string;
  /** Branch, tag, or commit SHA (default: the repo's default branch). */
  ref?: string;
}

/** A single file to materialize, with a repo-relative POSIX path. */
export interface RepoFile {
  path: string;
  /** UTF-8 text content. */
  content: string;
}

/** The source of repo contents — real impl clones/reads; injectable for tests. */
export interface RepoFetcher {
  fetch(repo: RepoRef): Promise<RepoFile[]>;
}

export interface CheckoutOptions {
  /** Mount the repo under this sandbox-relative subdir (default: the root). */
  mountDir?: string;
}

export interface WorkspaceCheckout {
  /** Absolute path the repo was mounted at. */
  mountPath: string;
  repo: RepoRef;
  /** Number of files written. */
  fileCount: number;
  /** Repo-relative paths written. */
  files: string[];
}

/**
 * Fetch the repo's files and write them into the sandbox at `mountDir` (default
 * the root). Every path goes through {@link Sandbox.resolve}, so a file whose
 * path escapes the workspace (`../…` or absolute) throws `SandboxPathError`
 * before anything is written outside the sandbox.
 */
export async function checkoutRepo(
  sandbox: Sandbox,
  repo: RepoRef,
  fetcher: RepoFetcher,
  options: CheckoutOptions = {},
): Promise<WorkspaceCheckout> {
  const mountRel = options.mountDir ?? '.';
  const mountPath = sandbox.resolve(mountRel);
  await mkdir(mountPath, { recursive: true });

  const files = await fetcher.fetch(repo);
  const written: string[] = [];
  for (const file of files) {
    const target = sandbox.resolve(join(mountRel, file.path)); // throws on escape
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written.push(file.path);
  }

  return { mountPath, repo, fileCount: written.length, files: written };
}

/** A fetcher backed by an in-memory file list — for tests and composition. */
export class InMemoryRepoFetcher implements RepoFetcher {
  constructor(private readonly files: RepoFile[]) {}

  async fetch(): Promise<RepoFile[]> {
    return this.files;
  }
}
