import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { LocalSandboxProvider } from '../local-sandbox';
import { Sandbox, SandboxPathError } from '../sandbox';
import { checkoutRepo, InMemoryRepoFetcher, RepoFetcher } from '../repo-checkout';

const repo = { owner: 'acme', repo: 'notes-api', ref: 'main' };

describe('checkoutRepo', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-co-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('materializes all repo files into the sandbox root, creating nested dirs', async () => {
    const fetcher = new InMemoryRepoFetcher([
      { path: 'package.json', content: '{"name":"notes-api"}' },
      { path: 'src/main.ts', content: 'console.log("hi")' },
    ]);

    const result = await checkoutRepo(sandbox, repo, fetcher);

    expect(result.mountPath).toBe(sandbox.rootDir);
    expect(result.fileCount).toBe(2);
    expect(result.files.sort()).toEqual(['package.json', 'src/main.ts']);
    expect(await readFile(sandbox.resolve('package.json'), 'utf8')).toBe('{"name":"notes-api"}');
    expect(await readFile(sandbox.resolve('src/main.ts'), 'utf8')).toBe('console.log("hi")');
  });

  it('mounts under a subdir when mountDir is given', async () => {
    const fetcher = new InMemoryRepoFetcher([{ path: 'a.txt', content: 'A' }]);
    const result = await checkoutRepo(sandbox, repo, fetcher, { mountDir: 'repo' });

    expect(result.mountPath).toBe(sandbox.resolve('repo'));
    expect((await stat(sandbox.resolve('repo'))).isDirectory()).toBe(true);
    expect(await readFile(sandbox.resolve('repo/a.txt'), 'utf8')).toBe('A');
  });

  it('rejects a repo file whose path escapes the workspace, writing nothing outside', async () => {
    const fetcher = new InMemoryRepoFetcher([{ path: '../evil.txt', content: 'pwned' }]);
    await expect(checkoutRepo(sandbox, repo, fetcher)).rejects.toBeInstanceOf(SandboxPathError);
    // nothing leaked next to the sandbox root
    await expect(stat(join(baseDir, 'evil.txt'))).rejects.toThrow();
  });

  it('passes the repo ref through to the fetcher', async () => {
    let seen: typeof repo | undefined;
    const fetcher: RepoFetcher = {
      async fetch(r) {
        seen = r as typeof repo;
        return [];
      },
    };
    const result = await checkoutRepo(sandbox, repo, fetcher);
    expect(seen).toEqual(repo);
    expect(result.fileCount).toBe(0);
  });
});

describe('InMemoryRepoFetcher', () => {
  it('returns the configured files', async () => {
    const files = [{ path: 'x.ts', content: 'x' }];
    expect(await new InMemoryRepoFetcher(files).fetch()).toBe(files);
  });
});
