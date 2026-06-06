import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { writeFile } from '../file-edits';
import {
  diffSnapshots,
  lineDiff,
  listWorkspaceFiles,
  snapshotWorkspace,
} from '../diff';

describe('lineDiff', () => {
  it('reports no changes for identical text', () => {
    const d = lineDiff('a\nb\n', 'a\nb\n');
    expect(d.additions).toBe(0);
    expect(d.deletions).toBe(0);
  });

  it('counts additions and deletions and marks lines', () => {
    const d = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(d.additions).toBe(2); // B, d
    expect(d.deletions).toBe(1); // b
    expect(d.diff).toContain(' a');
    expect(d.diff).toContain('-b');
    expect(d.diff).toContain('+B');
    expect(d.diff).toContain('+d');
  });

  it('treats a from-empty diff as all additions', () => {
    expect(lineDiff('', 'x\ny\n')).toMatchObject({ additions: 2, deletions: 0 });
  });
});

describe('diffSnapshots', () => {
  it('classifies added, modified, deleted and skips unchanged', () => {
    const before = { 'keep.ts': 'k', 'mod.ts': 'old', 'gone.ts': 'bye' };
    const after = { 'keep.ts': 'k', 'mod.ts': 'new', 'fresh.ts': 'hi' };
    const changes = diffSnapshots(before, after);

    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['fresh.ts', 'added'],
      ['gone.ts', 'deleted'],
      ['mod.ts', 'modified'],
    ]);
    expect(changes.find((c) => c.path === 'keep.ts')).toBeUndefined(); // unchanged skipped
  });
});

describe('workspace snapshot + diff (real sandbox)', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-diff-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('lists files recursively and skips ignored dirs', async () => {
    await writeFile(sandbox, 'src/a.ts', 'a');
    await writeFile(sandbox, 'src/sub/b.ts', 'b');
    await writeFile(sandbox, 'node_modules/dep/index.js', 'x');
    expect(await listWorkspaceFiles(sandbox)).toEqual(['src/a.ts', 'src/sub/b.ts']);
  });

  it('snapshots then diffs real edits', async () => {
    await writeFile(sandbox, 'src/a.ts', 'one');
    const before = await snapshotWorkspace(sandbox);

    await writeFile(sandbox, 'src/a.ts', 'two'); // modify
    await writeFile(sandbox, 'src/b.ts', 'new'); // add
    const after = await snapshotWorkspace(sandbox);

    const changes = diffSnapshots(before, after);
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['src/b.ts', 'added'],
    ]);
  });
});
