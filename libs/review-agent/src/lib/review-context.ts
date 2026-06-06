/**
 * Review context assembly (HELIX-111): gather what the Code Review Agent needs to
 * look at — the **changed hunks plus surrounding code** — into one structured
 * context the review prompts (HELIX-112) consume.
 *
 * Input is the diff (the file changes produced by the Coding Agent); an optional
 * injected {@link FileContentReader} pulls the full current content of each
 * changed file for surrounding context, and an optional spec is carried along so
 * the review can check plan-conformance. Pure assembly + a reader seam — no LLM.
 */
export type DiffStatus = 'added' | 'modified' | 'deleted';

/** One changed file: its status, unified-ish diff, and line counts. */
export interface DiffFile {
  path: string;
  status: DiffStatus;
  diff: string;
  additions: number;
  deletions: number;
}

/** Reads the full current content of a file (from the sandbox / git); `undefined` if absent. */
export interface FileContentReader {
  read(path: string): Promise<string | undefined>;
}

export interface ReviewFileContext extends DiffFile {
  /** Full file content for surrounding context (omitted for deleted/too-large files). */
  content?: string;
}

export interface ReviewContextSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

export interface ReviewContext {
  files: ReviewFileContext[];
  summary: ReviewContextSummary;
  /** The requirements/plan text the review can check conformance against. */
  spec?: string;
}

export interface AssembleReviewContextOptions {
  /** Attach each changed file's full content (skipped for deleted files). */
  reader?: FileContentReader;
  /** Requirements/plan text to carry into the review. */
  spec?: string;
  /** Skip attaching content larger than this many chars (default 24000). */
  maxFileChars?: number;
}

/** Assemble a {@link ReviewContext} from a diff (optionally enriched with file content). */
export async function assembleReviewContext(
  diff: DiffFile[],
  options: AssembleReviewContextOptions = {},
): Promise<ReviewContext> {
  const maxFileChars = options.maxFileChars ?? 24_000;

  const files: ReviewFileContext[] = [];
  for (const file of diff) {
    const entry: ReviewFileContext = { ...file };
    if (options.reader && file.status !== 'deleted') {
      const content = await options.reader.read(file.path);
      if (content !== undefined && content.length <= maxFileChars) {
        entry.content = content;
      }
    }
    files.push(entry);
  }

  return {
    files,
    spec: options.spec,
    summary: {
      fileCount: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    },
  };
}

export interface FormatReviewContextOptions {
  /** Cap the whole rendered block (default 60000 chars). */
  maxChars?: number;
}

/** Render a review context into a prompt-ready block. */
export function formatReviewContext(
  context: ReviewContext,
  options: FormatReviewContextOptions = {},
): string {
  const maxChars = options.maxChars ?? 60_000;
  const parts: string[] = [
    `<review_summary>`,
    `${context.summary.fileCount} file(s), +${context.summary.additions}/-${context.summary.deletions}`,
    `</review_summary>`,
  ];
  if (context.spec?.trim()) {
    parts.push('', '<spec>', context.spec.trim(), '</spec>');
  }
  for (const file of context.files) {
    parts.push(
      '',
      `<file path="${file.path}" status="${file.status}">`,
      '<diff>',
      file.diff,
      '</diff>',
    );
    if (file.content !== undefined) {
      parts.push('<content>', file.content, '</content>');
    }
    parts.push('</file>');
  }
  const rendered = parts.join('\n');
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars)}\n… (truncated)` : rendered;
}
