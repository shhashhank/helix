import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRepoFetcher, LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { writeFile } from '../file-edits';
import { ScaffoldConflictError } from '../scaffold';
import {
  captureWorkspaceDiff,
  formatWorkspaceDiff,
  populateWorkspace,
} from '../workspace-populate';

describe('populateWorkspace', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-populate-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('scaffolds a new project and snapshots the baseline', async () => {
    const result = await populateWorkspace(sandbox, {
      kind: 'scaffold',
      files: [
        { path: 'src/app.ts', content: 'export const app = 1;\n' },
        { path: 'package.json', content: '{"name":"demo"}\n' },
      ],
    });

    expect(result.kind).toBe('scaffold');
    expect(result.files.sort()).toEqual(['package.json', 'src/app.ts']);
    expect(result.baseline['src/app.ts']).toBe('export const app = 1;\n');
    expect(result.baseline['package.json']).toBe('{"name":"demo"}\n');
  });

  it('checks out a repo via an in-memory fetcher and snapshots the baseline', async () => {
    const fetcher = new InMemoryRepoFetcher([
      { path: 'README.md', content: '# demo repo\n' },
      { path: 'src/index.ts', content: 'console.log("hi");\n' },
    ]);

    const result = await populateWorkspace(sandbox, { kind: 'checkout', repo: { repo: 'demo' }, fetcher });

    expect(result.kind).toBe('checkout');
    expect(result.files.sort()).toEqual(['README.md', 'src/index.ts']);
    expect(result.baseline['README.md']).toBe('# demo repo\n');
  });

  it('propagates a scaffold conflict (no overwrite) instead of writing over files', async () => {
    const spec = { kind: 'scaffold' as const, files: [{ path: 'a.ts', content: 'one' }] };
    await populateWorkspace(sandbox, spec);
    await expect(populateWorkspace(sandbox, spec)).rejects.toBeInstanceOf(ScaffoldConflictError);
  });
});

describe('captureWorkspaceDiff', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-diff-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('diffs the workspace against the populate baseline into a change set', async () => {
    const { baseline } = await populateWorkspace(sandbox, {
      kind: 'scaffold',
      files: [
        { path: 'keep.ts', content: 'same\n' },
        { path: 'edit.ts', content: 'old line\n' },
      ],
    });

    // The agent edits one file and adds another (keep.ts is untouched).
    await writeFile(sandbox, 'edit.ts', 'new line\n');
    await writeFile(sandbox, 'src/new.ts', 'export const n = 1;\n');

    const diff = await captureWorkspaceDiff(sandbox, baseline);

    expect(diff.summary).toEqual({ added: 1, modified: 1, deleted: 0, additions: 2, deletions: 1 });
    const byPath = Object.fromEntries(diff.changes.map((c) => [c.path, c.status]));
    expect(byPath).toEqual({ 'edit.ts': 'modified', 'src/new.ts': 'added' });
    expect(diff.changes.find((c) => c.path === 'keep.ts')).toBeUndefined(); // unchanged → not in the diff
  });

  it('reports no changes when nothing was touched', async () => {
    const { baseline } = await populateWorkspace(sandbox, {
      kind: 'scaffold',
      files: [{ path: 'a.ts', content: 'x\n' }],
    });
    const diff = await captureWorkspaceDiff(sandbox, baseline);
    expect(diff.changes).toEqual([]);
    expect(formatWorkspaceDiff(diff)).toBe('No file changes.');
  });
});

describe('formatWorkspaceDiff', () => {
  it('renders a compact markdown summary with per-file status + counts', () => {
    const md = formatWorkspaceDiff({
      summary: { added: 1, modified: 1, deleted: 0, additions: 5, deletions: 2 },
      changes: [
        { path: 'src/new.ts', status: 'added', additions: 3, deletions: 0, diff: '' },
        { path: 'src/app.ts', status: 'modified', additions: 2, deletions: 2, diff: '' },
      ],
    });

    expect(md).toContain('2 files changed');
    expect(md).toContain('(+5 −2)');
    expect(md).toContain('- `A` src/new.ts (+3 −0)');
    expect(md).toContain('- `M` src/app.ts (+2 −2)');
  });
});
