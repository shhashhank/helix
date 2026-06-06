/**
 * Scaffolding core (HELIX-104): the generic mechanism a per-stack generator uses
 * to produce starter files and write them into the sandbox.
 *
 * A generator returns a list of {@link ScaffoldFile}s (path + content);
 * {@link applyScaffold} writes them through the HELIX-103 file tools (so the
 * sandbox path guard applies) and refuses to clobber existing files unless told
 * to — checking all targets up front so a conflict never leaves a half-written
 * tree. {@link resourceNames} gives generators the casing/pluralisation forms a
 * template needs from one resource name.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sandbox } from '@helix/sandbox';
import { writeFile } from './file-edits';

/** One file a generator produces. */
export interface ScaffoldFile {
  /** Workspace-relative path. */
  path: string;
  content: string;
}

/** The casing/number forms a generator needs from a resource name. */
export interface ResourceNames {
  raw: string;
  /** `note`, `note-item`. */
  kebab: string;
  /** `note`, `noteItem`. */
  camel: string;
  /** `Note`, `NoteItem`. */
  pascal: string;
  /** `notes`, `note-items`. */
  pluralKebab: string;
  /** `notes`, `noteItems`. */
  pluralCamel: string;
}

/** Derive name forms from a raw resource name (`note`, `noteItem`, `note_item`, …). */
export function resourceNames(raw: string): ResourceNames {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (words.length === 0) {
    throw new Error(`invalid resource name: "${raw}"`);
  }
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const plural = [...words.slice(0, -1), pluralize(words[words.length - 1])];
  const camelOf = (ws: string[]) => ws[0] + ws.slice(1).map(cap).join('');

  return {
    raw,
    kebab: words.join('-'),
    camel: camelOf(words),
    pascal: words.map(cap).join(''),
    pluralKebab: plural.join('-'),
    pluralCamel: camelOf(plural),
  };
}

function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

export class ScaffoldConflictError extends Error {
  constructor(public readonly path: string) {
    super(`scaffold target already exists: ${path}`);
    this.name = 'ScaffoldConflictError';
  }
}

export interface ApplyScaffoldOptions {
  /** Write under this sandbox-relative dir (default: the root). */
  baseDir?: string;
  /** Overwrite existing files instead of failing on conflict. */
  overwrite?: boolean;
}

/**
 * Write a generated file set into the sandbox. Unless `overwrite` is set, throws
 * {@link ScaffoldConflictError} (before writing anything) if any target exists.
 */
export async function applyScaffold(
  sandbox: Sandbox,
  files: ScaffoldFile[],
  options: ApplyScaffoldOptions = {},
): Promise<{ written: string[] }> {
  const baseDir = options.baseDir ?? '.';
  const targets = files.map((f) => ({ rel: join(baseDir, f.path), content: f.content }));

  if (!options.overwrite) {
    for (const t of targets) {
      if (await exists(sandbox, t.rel)) throw new ScaffoldConflictError(t.rel);
    }
  }

  const written: string[] = [];
  for (const t of targets) {
    await writeFile(sandbox, t.rel, t.content);
    written.push(t.rel);
  }
  return { written };
}

async function exists(sandbox: Sandbox, rel: string): Promise<boolean> {
  try {
    await stat(sandbox.resolve(rel));
    return true;
  } catch {
    return false;
  }
}
