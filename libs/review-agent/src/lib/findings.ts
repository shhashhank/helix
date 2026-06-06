/**
 * Findings schema + severity model (HELIX-113): the machine-readable output of
 * the review. Each multi-aspect pass (HELIX-112) is re-run with a **forced tool**
 * so the model returns structured {@link Finding}s — severity, file/line, message,
 * optional suggestion — validated against the schema. A severity model then
 * summarises them and decides what blocks (the input the merge gate, HELIX-35,
 * keys off).
 *
 * Zod is the single source of truth for the type, the validator, and the tool's
 * JSON Schema; the aspect is stamped on by us (the pass is focused), so the model
 * only has to list issues.
 */
import type {
  Effort,
  LlmCallContext,
  LlmCompletion,
  LlmProvider,
  LlmToolDef,
  LlmToolUsePart,
  LlmUsage,
  ModelTier,
} from '@helix/llm';
import { z } from 'zod';
import { formatReviewContext, ReviewContext } from './review-context';
import { buildAspectSystemPrompt, REVIEW_ASPECTS, ReviewAspect } from './review-prompts';

export const REVIEW_SEVERITIES = ['blocker', 'major', 'minor', 'info'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

const SEVERITY_RANK: Record<ReviewSeverity, number> = { info: 0, minor: 1, major: 2, blocker: 3 };

/** Order two severities, highest first. */
export function compareSeverityDesc(a: ReviewSeverity, b: ReviewSeverity): number {
  return SEVERITY_RANK[b] - SEVERITY_RANK[a];
}

const RawFindingSchema = z.object({
  severity: z.enum(REVIEW_SEVERITIES),
  file: z.string().min(1).describe('The file the issue is in.'),
  line: z.number().int().positive().optional().describe('1-based line, when known.'),
  message: z.string().min(1).describe('What is wrong, specifically.'),
  suggestion: z.string().min(1).optional().describe('How to fix it (optional).'),
});

const FindingsSetSchema = z.object({ findings: z.array(RawFindingSchema) });

export const FINDINGS_JSON_SCHEMA = z.toJSONSchema(FindingsSetSchema) as Record<string, unknown>;

/** A single review finding (the aspect is stamped on by the runner). */
export interface Finding {
  aspect: ReviewAspect;
  severity: ReviewSeverity;
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export class FindingsValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid findings: ${issues.join('; ')}`);
    this.name = 'FindingsValidationError';
  }
}

/** Validate tool output into {@link Finding}s, stamping the aspect on each. */
export function parseFindings(input: unknown, aspect: ReviewAspect): Finding[] {
  const result = FindingsSetSchema.safeParse(input);
  if (!result.success) {
    throw new FindingsValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data.findings.map((f) => ({ aspect, ...f }));
}

export const FINDINGS_TOOL_NAME = 'emit_findings';

export const FINDINGS_TOOL: LlmToolDef = {
  name: FINDINGS_TOOL_NAME,
  description: 'Return the review findings. Call exactly once; return an empty list if there are none.',
  inputSchema: FINDINGS_JSON_SCHEMA,
};

export function buildFindingsSystemPrompt(aspect: ReviewAspect): string {
  return [
    buildAspectSystemPrompt(aspect),
    '',
    `Return your findings by calling ${FINDINGS_TOOL_NAME} exactly once; return an empty list if there are no issues.`,
  ].join('\n');
}

export class ReviewFindingsError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'ReviewFindingsError';
  }
}

export interface ReviewFindingsOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

export interface AspectFindings {
  findings: Finding[];
  model: string;
  usage: LlmUsage;
}

/** Run one aspect's review as a forced findings tool call. */
export async function reviewForFindings(
  context: ReviewContext,
  aspect: ReviewAspect,
  llm: LlmProvider,
  options: ReviewFindingsOptions = {},
): Promise<AspectFindings> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: buildFindingsSystemPrompt(aspect),
    messages: [{ role: 'user', content: buildUserPrompt(context) }],
    tools: [FINDINGS_TOOL],
    toolChoice: { name: FINDINGS_TOOL_NAME },
    context: options.context,
  });
  const toolUse = completion.content.find(
    (p): p is LlmToolUsePart => p.type === 'tool_use' && p.name === FINDINGS_TOOL_NAME,
  );
  if (!toolUse) {
    throw new ReviewFindingsError(`model did not call ${FINDINGS_TOOL_NAME}`, completion);
  }
  return { findings: parseFindings(toolUse.input, aspect), model: completion.model, usage: completion.usage };
}

export interface ReviewAllFindingsOptions extends ReviewFindingsOptions {
  aspects?: ReviewAspect[];
}

/** Run findings review across several aspects and merge them. */
export async function reviewAllFindings(
  context: ReviewContext,
  llm: LlmProvider,
  options: ReviewAllFindingsOptions = {},
): Promise<{ findings: Finding[]; usage: LlmUsage }> {
  const aspects = options.aspects ?? [...REVIEW_ASPECTS];
  const findings: Finding[] = [];
  let usage: LlmUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  for (const aspect of aspects) {
    const result = await reviewForFindings(context, aspect, llm, options);
    findings.push(...result.findings);
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens + result.usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens + result.usage.cacheReadInputTokens,
    };
  }
  return { findings, usage };
}

export interface FindingsSummary {
  total: number;
  bySeverity: Record<ReviewSeverity, number>;
  byAspect: Record<string, number>;
  highestSeverity?: ReviewSeverity;
}

/** Count findings by severity + aspect and note the highest severity present. */
export function summarizeFindings(findings: Finding[]): FindingsSummary {
  const bySeverity: Record<ReviewSeverity, number> = { blocker: 0, major: 0, minor: 0, info: 0 };
  const byAspect: Record<string, number> = {};
  let highest: ReviewSeverity | undefined;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byAspect[f.aspect] = (byAspect[f.aspect] ?? 0) + 1;
    if (!highest || SEVERITY_RANK[f.severity] > SEVERITY_RANK[highest]) highest = f.severity;
  }
  return { total: findings.length, bySeverity, byAspect, highestSeverity: highest };
}

/** True if any finding is at or above `threshold` severity (default `major`) — the merge-gate signal. */
export function isBlocking(findings: Finding[], threshold: ReviewSeverity = 'major'): boolean {
  return findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[threshold]);
}

function buildUserPrompt(context: ReviewContext): string {
  return ['Review the following change:', '', formatReviewContext(context)].join('\n');
}
