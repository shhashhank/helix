import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { readFile } from '../file-edits';
import {
  applyScaffold,
  resourceNames,
  ScaffoldConflictError,
  ScaffoldFile,
} from '../scaffold';

describe('resourceNames', () => {
  it('derives forms from a single-word name', () => {
    expect(resourceNames('note')).toEqual({
      raw: 'note',
      kebab: 'note',
      camel: 'note',
      pascal: 'Note',
      pluralKebab: 'notes',
      pluralCamel: 'notes',
    });
  });

  it('handles multi-word names (kebab, snake, camel input)', () => {
    for (const raw of ['note-item', 'note_item', 'noteItem']) {
      expect(resourceNames(raw)).toMatchObject({
        kebab: 'note-item',
        camel: 'noteItem',
        pascal: 'NoteItem',
        pluralKebab: 'note-items',
        pluralCamel: 'noteItems',
      });
    }
  });

  it('pluralises -y and sibilant endings', () => {
    expect(resourceNames('category').pluralKebab).toBe('categories');
    expect(resourceNames('box').pluralKebab).toBe('boxes');
  });

  it('throws on an empty name', () => {
    expect(() => resourceNames('   ')).toThrow(/invalid resource name/);
  });
});

describe('applyScaffold', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  const files: ScaffoldFile[] = [
    { path: 'src/a.ts', content: 'A' },
    { path: 'src/sub/b.ts', content: 'B' },
  ];

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-scaffold-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('writes all files and reports the written paths', async () => {
    const { written } = await applyScaffold(sandbox, files);
    expect(written).toEqual([join('.', 'src/a.ts'), join('.', 'src/sub/b.ts')]);
    expect(await readFile(sandbox, 'src/a.ts')).toBe('A');
    expect(await readFile(sandbox, 'src/sub/b.ts')).toBe('B');
  });

  it('mounts under baseDir when given', async () => {
    await applyScaffold(sandbox, [{ path: 'x.ts', content: 'X' }], { baseDir: 'pkg' });
    expect(await readFile(sandbox, 'pkg/x.ts')).toBe('X');
  });

  it('refuses to clobber an existing file and writes nothing on conflict', async () => {
    await applyScaffold(sandbox, [{ path: 'src/a.ts', content: 'first' }]);
    // a second apply that includes the existing file should fail before writing the new one
    await expect(
      applyScaffold(sandbox, [
        { path: 'src/new.ts', content: 'new' },
        { path: 'src/a.ts', content: 'second' },
      ]),
    ).rejects.toBeInstanceOf(ScaffoldConflictError);
    expect(await readFile(sandbox, 'src/a.ts')).toBe('first'); // unchanged
    await expect(readFile(sandbox, 'src/new.ts')).rejects.toThrow(); // not written
  });

  it('overwrites when overwrite: true', async () => {
    await applyScaffold(sandbox, [{ path: 'src/a.ts', content: 'first' }]);
    await applyScaffold(sandbox, [{ path: 'src/a.ts', content: 'second' }], { overwrite: true });
    expect(await readFile(sandbox, 'src/a.ts')).toBe('second');
  });
});
