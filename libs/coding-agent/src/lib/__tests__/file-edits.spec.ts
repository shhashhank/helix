import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider, Sandbox, SandboxPathError } from '@helix/sandbox';
import {
  FileNotFoundError,
  patchFile,
  PatchNotApplicableError,
  readFile,
  writeFile,
} from '../file-edits';

describe('file edits (in sandbox)', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-fe-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('writes (creating nested dirs) then reads back', async () => {
    await writeFile(sandbox, 'src/app.ts', 'export const x = 1;');
    expect(await readFile(sandbox, 'src/app.ts')).toBe('export const x = 1;');
  });

  it('overwrites an existing file', async () => {
    await writeFile(sandbox, 'a.txt', 'one');
    await writeFile(sandbox, 'a.txt', 'two');
    expect(await readFile(sandbox, 'a.txt')).toBe('two');
  });

  it('throws FileNotFoundError reading a missing file', async () => {
    await expect(readFile(sandbox, 'nope.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('refuses paths that escape the sandbox', async () => {
    await expect(readFile(sandbox, '../escape.txt')).rejects.toBeInstanceOf(SandboxPathError);
    await expect(writeFile(sandbox, '../escape.txt', 'x')).rejects.toBeInstanceOf(SandboxPathError);
  });

  describe('patchFile', () => {
    beforeEach(async () => {
      await writeFile(sandbox, 'f.ts', 'const a = 1;\nconst b = 1;\n');
    });

    it('replaces a unique snippet and reports one replacement', async () => {
      const { replacements } = await patchFile(sandbox, 'f.ts', { oldText: 'const a = 1;', newText: 'const a = 2;' });
      expect(replacements).toBe(1);
      expect(await readFile(sandbox, 'f.ts')).toBe('const a = 2;\nconst b = 1;\n');
    });

    it('replaces all occurrences with replaceAll', async () => {
      const { replacements } = await patchFile(sandbox, 'f.ts', { oldText: '= 1;', newText: '= 9;', replaceAll: true });
      expect(replacements).toBe(2);
      expect(await readFile(sandbox, 'f.ts')).toBe('const a = 9;\nconst b = 9;\n');
    });

    it('fails when the snippet is missing', async () => {
      await expect(patchFile(sandbox, 'f.ts', { oldText: 'nope', newText: 'x' })).rejects.toBeInstanceOf(
        PatchNotApplicableError,
      );
    });

    it('fails on an ambiguous snippet without replaceAll', async () => {
      await expect(
        patchFile(sandbox, 'f.ts', { oldText: '= 1;', newText: '= 2;' }),
      ).rejects.toThrow(/matches 2 times/);
    });

    it('fails on an empty oldText', async () => {
      await expect(patchFile(sandbox, 'f.ts', { oldText: '', newText: 'x' })).rejects.toBeInstanceOf(
        PatchNotApplicableError,
      );
    });
  });
});
