/**
 * File edit operations (HELIX-103) — the read / write / patch primitives the
 * coding agent uses to change code, **confined to a {@link Sandbox}**.
 *
 * Every path goes through `sandbox.resolve`, so edits can't touch anything
 * outside the workspace (a `../…` path throws `SandboxPathError`). `patch` does
 * an exact-snippet replace and refuses to apply when the snippet is missing or
 * ambiguous — the agent gets a clear error to correct against rather than a
 * silently wrong edit.
 */
import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Sandbox } from '@helix/sandbox';

export class FileNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`file not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export class PatchNotApplicableError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`cannot patch ${path}: ${reason}`);
    this.name = 'PatchNotApplicableError';
  }
}

/** Read a UTF-8 file from the workspace. Throws {@link FileNotFoundError} if absent. */
export async function readFile(sandbox: Sandbox, path: string): Promise<string> {
  const target = sandbox.resolve(path);
  try {
    return await fsReadFile(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
    throw err;
  }
}

/** Create or overwrite a UTF-8 file in the workspace, creating parent dirs. */
export async function writeFile(sandbox: Sandbox, path: string, content: string): Promise<void> {
  const target = sandbox.resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await fsWriteFile(target, content, 'utf8');
}

export interface FileEdit {
  /** Exact snippet to replace (must be present in the file). */
  oldText: string;
  newText: string;
  /** Replace every occurrence; otherwise the snippet must be unique. */
  replaceAll?: boolean;
}

/**
 * Replace `oldText` with `newText` in a workspace file. Fails closed: throws
 * {@link PatchNotApplicableError} if the snippet is empty, missing, or (without
 * `replaceAll`) matches more than once. Returns how many replacements were made.
 */
export async function patchFile(
  sandbox: Sandbox,
  path: string,
  edit: FileEdit,
): Promise<{ replacements: number }> {
  if (edit.oldText === '') {
    throw new PatchNotApplicableError(path, 'oldText must be non-empty');
  }
  const content = await readFile(sandbox, path);
  const matches = content.split(edit.oldText).length - 1;
  if (matches === 0) {
    throw new PatchNotApplicableError(path, 'oldText not found in file');
  }
  if (matches > 1 && !edit.replaceAll) {
    throw new PatchNotApplicableError(
      path,
      `oldText matches ${matches} times; pass replaceAll or add more surrounding context`,
    );
  }
  const updated = edit.replaceAll
    ? content.split(edit.oldText).join(edit.newText)
    : content.replace(edit.oldText, edit.newText);
  await writeFile(sandbox, path, updated);
  return { replacements: edit.replaceAll ? matches : 1 };
}
