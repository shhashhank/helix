import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalCommandRunner,
  LocalSandboxProvider,
  Sandbox,
  type CommandRunner,
} from '@helix/sandbox';
import {
  branchName,
  createGitBranch,
  isValidGitBranchName,
  slugify,
} from '../branching';

describe('slugify', () => {
  it('lowercases, dashes, collapses, and trims', () => {
    expect(slugify('Add Notes API!!')).toBe('add-notes-api');
    expect(slugify('  Foo   Bar  ')).toBe('foo-bar');
  });

  it('truncates without a trailing dash', () => {
    expect(slugify('a'.repeat(40) + ' ' + 'b'.repeat(40), 42)).toBe('a'.repeat(40) + '-b');
  });
});

describe('branchName', () => {
  it('builds helix/<run-id>/<slug>', () => {
    expect(branchName({ runId: 'run-123', description: 'Add a notes resource' })).toBe(
      'helix/run-123/add-a-notes-resource',
    );
  });

  it('sanitises the run id and falls back to "work" for an empty slug', () => {
    expect(branchName({ runId: 'run/42 weird', description: '!!!' })).toBe('helix/run-42-weird/work');
  });

  it('always yields a valid git ref', () => {
    expect(isValidGitBranchName(branchName({ runId: 'r1', description: 'feature: do X (v2)' }))).toBe(
      true,
    );
  });
});

describe('isValidGitBranchName', () => {
  it('accepts conventional names', () => {
    expect(isValidGitBranchName('helix/run-1/add-notes')).toBe(true);
    expect(isValidGitBranchName('HELIX-42/slug')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['space', 'foo bar'],
    ['double dot', 'foo..bar'],
    ['leading slash', '/foo'],
    ['trailing slash', 'foo/'],
    ['double slash', 'foo//bar'],
    ['tilde', 'foo~1'],
    ['trailing dot', 'foo.'],
    ['lock suffix', 'foo.lock'],
    ['dot segment', 'foo/.bar'],
  ])('rejects %s', (_label, name) => {
    expect(isValidGitBranchName(name)).toBe(false);
  });
});

describe('createGitBranch', () => {
  it('returns an error result without running git for an invalid name', async () => {
    let called = false;
    const runner: CommandRunner = {
      async run(command) {
        called = true;
        return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 };
      },
    };
    const result = await createGitBranch(runner, 'bad..name');
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/invalid git branch name/);
    expect(called).toBe(false);
  });

  it('creates and switches to the branch in a real git repo', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'helix-branch-test-'));
    const provider = new LocalSandboxProvider({ baseDir });
    const sandbox: Sandbox = await provider.provision();
    const runner = new LocalCommandRunner(sandbox);
    try {
      const init = await runner.run('git', { args: ['init'] });
      expect(init.exitCode).toBe(0);

      const name = branchName({ runId: 'run-7', description: 'add notes endpoint' });
      const result = await createGitBranch(runner, name);
      expect(result.ok).toBe(true);

      const current = await runner.run('git', { args: ['branch', '--show-current'] });
      expect(current.stdout.trim()).toBe(name);
    } finally {
      await provider.disposeAll();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
