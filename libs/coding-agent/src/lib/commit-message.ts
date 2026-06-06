/**
 * Commit message generation (HELIX-110): turn a {@link CommitGroup} (HELIX-105)
 * into a **Conventional Commits** message — `type(scope): subject` + an optional
 * body listing the changes.
 *
 * `buildCommitMessage` is a deterministic builder (offline, always works) that
 * infers the type/scope/subject from the changes; `generateCommitMessage` asks
 * an LLM for nicer prose via a forced, schema-validated tool and **falls back to
 * the deterministic builder** on any problem — so it never blocks a commit.
 */
import type {
  Effort,
  LlmCallContext,
  LlmProvider,
  LlmToolDef,
  LlmToolUsePart,
  ModelTier,
} from '@helix/llm';
import { z } from 'zod';
import { CommitGroup } from './commit-grouping';
import { FileChange } from './diff';

export const COMMIT_TYPES = ['feat', 'fix', 'chore', 'test', 'docs', 'refactor', 'build'] as const;
export type CommitType = (typeof COMMIT_TYPES)[number];

export interface CommitMessage {
  type: CommitType;
  scope?: string;
  subject: string;
  body?: string;
  /** The assembled message (`type(scope): subject` + blank line + body). */
  text: string;
}

const CommitMessageSchema = z.object({
  type: z.enum(COMMIT_TYPES),
  scope: z.string().min(1).optional(),
  subject: z.string().min(1).max(72).describe('Imperative, lower-case, no trailing period.'),
  body: z.string().min(1).optional(),
});

/** Assemble the full message text from its parts. */
export function formatCommitMessage(parts: Omit<CommitMessage, 'text'>): CommitMessage {
  const header = `${parts.type}${parts.scope ? `(${parts.scope})` : ''}: ${parts.subject}`;
  const text = parts.body ? `${header}\n\n${parts.body}` : header;
  return { ...parts, text };
}

export interface BuildCommitMessageOptions {
  /** Include the per-file body (default true). */
  includeBody?: boolean;
}

/** Deterministically build a Conventional Commits message from a group. */
export function buildCommitMessage(
  group: CommitGroup,
  options: BuildCommitMessageOptions = {},
): CommitMessage {
  const scope = scopeFromKey(group.key);
  const type = inferType(group.changes);
  const subject = buildSubject(type, scope, group.changes);
  const body =
    options.includeBody === false
      ? undefined
      : group.changes
          .map((c) => `- ${c.status} ${c.path} (+${c.additions}/-${c.deletions})`)
          .join('\n');
  return formatCommitMessage({ type, scope, subject, body });
}

function scopeFromKey(key: string): string | undefined {
  if (key === '(root)') return undefined;
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

function inferType(changes: FileChange[]): CommitType {
  const paths = changes.map((c) => c.path);
  if (paths.length > 0 && paths.every((p) => /(\.spec\.|\.test\.|(^|\/)(?:test|__tests__)\/)/.test(p))) {
    return 'test';
  }
  if (paths.length > 0 && paths.every((p) => /\.mdx?$|(^|\/)docs\//.test(p))) {
    return 'docs';
  }
  if (changes.some((c) => c.status === 'added')) return 'feat';
  return 'chore';
}

function buildSubject(type: CommitType, scope: string | undefined, changes: FileChange[]): string {
  const count = changes.length;
  const target = scope ?? `${count} file${count === 1 ? '' : 's'}`;
  switch (type) {
    case 'feat':
      return `add ${target}`;
    case 'fix':
      return `fix ${target}`;
    case 'test':
      return `add tests for ${scope ?? 'changes'}`;
    case 'docs':
      return `update docs${scope ? ` for ${scope}` : ''}`;
    default:
      return `update ${target}`;
  }
}

export const COMMIT_MESSAGE_TOOL_NAME = 'emit_commit_message';

export const COMMIT_MESSAGE_TOOL: LlmToolDef = {
  name: COMMIT_MESSAGE_TOOL_NAME,
  description: 'Return a Conventional Commits message for the change set. Call exactly once.',
  inputSchema: z.toJSONSchema(CommitMessageSchema) as Record<string, unknown>,
};

export const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  'You write Conventional Commits messages. Given a set of file changes, call',
  `${COMMIT_MESSAGE_TOOL_NAME} exactly once with a type (feat/fix/chore/test/docs/refactor/build),`,
  'an optional scope, an imperative lower-case subject (≤ 72 chars, no trailing period), and an',
  'optional body summarising the change. Be accurate and concise; do not invent changes.',
].join('\n');

export interface GenerateCommitMessageOptions extends BuildCommitMessageOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
  /** Max diff chars included in the prompt (default 6000). */
  maxDiffChars?: number;
}

/**
 * Generate a commit message via the LLM, falling back to {@link buildCommitMessage}
 * on a missing tool call, invalid output, or any error — so it always returns one.
 */
export async function generateCommitMessage(
  group: CommitGroup,
  llm: LlmProvider,
  options: GenerateCommitMessageOptions = {},
): Promise<CommitMessage> {
  try {
    const completion = await llm.complete({
      tier: options.tier ?? 'opus',
      effort: options.effort,
      system: COMMIT_MESSAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(group, options.maxDiffChars ?? 6000) }],
      tools: [COMMIT_MESSAGE_TOOL],
      toolChoice: { name: COMMIT_MESSAGE_TOOL_NAME },
      context: options.context,
    });
    const toolUse = completion.content.find(
      (p): p is LlmToolUsePart => p.type === 'tool_use' && p.name === COMMIT_MESSAGE_TOOL_NAME,
    );
    const parsed = toolUse && CommitMessageSchema.safeParse(toolUse.input);
    if (!parsed || !parsed.success) return buildCommitMessage(group, options);
    return formatCommitMessage(parsed.data);
  } catch {
    return buildCommitMessage(group, options);
  }
}

function buildPrompt(group: CommitGroup, maxDiffChars: number): string {
  const files = group.changes
    .map((c) => `### ${c.status} ${c.path} (+${c.additions}/-${c.deletions})\n${c.diff}`)
    .join('\n\n');
  const diff = files.length > maxDiffChars ? `${files.slice(0, maxDiffChars)}\n… (truncated)` : files;
  return [
    `Write a commit message for this change group (${group.key}).`,
    '',
    '<changes>',
    diff,
    '</changes>',
  ].join('\n');
}
