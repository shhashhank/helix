/**
 * Ambiguity detection + clarification questions (HELIX-94).
 *
 * Given a {@link RequirementsSpec} from HELIX-93, find the genuinely
 * under-specified or multiply-interpretable parts and turn each into a concrete
 * clarification question. Every question carries a **confidence** (0–1): how
 * confident we are that building on the proposed default assumption — *without*
 * asking — would be correct. A confidence **threshold** (plus importance) then
 * decides which questions must actually be put to the user vs. which can be
 * auto-resolved on their default. The questions are the input the clarification
 * loop (HELIX-95) resolves.
 *
 * Same reliability pattern as extraction: a forced tool call returns structured
 * output that is validated against the schema before we trust it.
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
import { RequirementsSpec } from './requirements';

/** How much an unanswered question matters to the build. */
export const CLARIFICATION_IMPORTANCE = ['blocking', 'important', 'optional'] as const;
export type ClarificationImportance = (typeof CLARIFICATION_IMPORTANCE)[number];

/** Default confidence threshold — at/above this we may proceed on the assumption. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export const ClarificationQuestionSchema = z.object({
  id: z.string().min(1).describe('Stable id, e.g. "CQ-1".'),
  topic: z.string().min(1).describe('The area the question concerns, e.g. "authentication".'),
  question: z.string().min(1).describe('A specific, answerable clarification question.'),
  importance: z
    .enum(CLARIFICATION_IMPORTANCE)
    .describe('blocking = cannot proceed; important = materially affects design; optional = nice to confirm.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('0–1 confidence that proceeding on defaultAssumption (without asking) is correct.'),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe('Suggested answer choices, when there is a small set.'),
  defaultAssumption: z
    .string()
    .min(1)
    .optional()
    .describe('What to assume if the question goes unanswered.'),
  rationale: z.string().min(1).optional().describe('Why this needs clarifying.'),
});
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

// Tool input must be an object, so the question array is wrapped.
export const ClarificationSetSchema = z.object({
  questions: z.array(ClarificationQuestionSchema),
});
export type ClarificationSet = z.infer<typeof ClarificationSetSchema>;

export const CLARIFICATIONS_JSON_SCHEMA = z.toJSONSchema(ClarificationSetSchema) as Record<
  string,
  unknown
>;

export class ClarificationValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid clarification questions: ${issues.join('; ')}`);
    this.name = 'ClarificationValidationError';
  }
}

/** Validate unknown tool output into a list of {@link ClarificationQuestion}. */
export function parseClarificationSet(input: unknown): ClarificationQuestion[] {
  const result = ClarificationSetSchema.safeParse(input);
  if (!result.success) {
    throw new ClarificationValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data.questions;
}

export const CLARIFICATIONS_TOOL_NAME = 'emit_clarification_questions';

export const CLARIFICATIONS_TOOL: LlmToolDef = {
  name: CLARIFICATIONS_TOOL_NAME,
  description:
    'Return clarification questions for the ambiguous or under-specified parts of the spec. ' +
    'Call exactly once; return an empty list if the spec is already clear enough to build from.',
  inputSchema: CLARIFICATIONS_JSON_SCHEMA,
};

export const CLARIFICATION_SYSTEM_PROMPT = [
  'You are a senior requirements analyst reviewing a draft requirements specification for ambiguity',
  'and gaps before implementation begins. Identify the points that are genuinely under-specified or',
  'open to more than one reasonable interpretation — pay special attention to the spec’s',
  'openQuestions, vaguely worded requirements, and risky assumptions.',
  '',
  `For each issue, call ${CLARIFICATIONS_TOOL_NAME} with a clear, specific, answerable question, and:`,
  '- classify importance: "blocking" (work cannot sensibly proceed), "important" (materially affects',
  '  the design), or "optional" (nice to confirm);',
  '- set confidence (0–1): how confident you are that proceeding on your defaultAssumption WITHOUT',
  '  asking would be correct — low confidence means the question really should be asked;',
  '- when there is a small set of likely answers, list them as options;',
  '- propose a sensible defaultAssumption to use if the question goes unanswered;',
  '- give a brief rationale.',
  '',
  'Do not ask about things the spec already answers, and do not introduce new scope. If the spec is',
  'already clear enough to build from, return an empty questions list. Call the tool exactly once.',
].join('\n');

export interface GenerateClarificationsOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
  /** The original request text, for extra context (optional). */
  requestText?: string;
}

export interface ClarificationResult {
  questions: ClarificationQuestion[];
  model: string;
  usage: LlmUsage;
}

export class ClarificationGenerationError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'ClarificationGenerationError';
  }
}

/**
 * Analyse a spec for ambiguity and return structured clarification questions.
 * Throws {@link ClarificationGenerationError} if the model returns no tool call,
 * and {@link ClarificationValidationError} if the output is malformed.
 */
export async function generateClarifications(
  spec: RequirementsSpec,
  llm: LlmProvider,
  options: GenerateClarificationsOptions = {},
): Promise<ClarificationResult> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: CLARIFICATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(spec, options.requestText) }],
    tools: [CLARIFICATIONS_TOOL],
    toolChoice: { name: CLARIFICATIONS_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (part): part is LlmToolUsePart =>
      part.type === 'tool_use' && part.name === CLARIFICATIONS_TOOL_NAME,
  );
  if (!toolUse) {
    throw new ClarificationGenerationError(
      `model did not call ${CLARIFICATIONS_TOOL_NAME}; cannot generate clarifications`,
      completion,
    );
  }

  return {
    questions: parseClarificationSet(toolUse.input),
    model: completion.model,
    usage: completion.usage,
  };
}

/** The outcome of applying a confidence threshold to a set of questions. */
export interface ClarificationTriage {
  /** Must be put to the user: blocking, or confidence below the threshold. */
  toAsk: ClarificationQuestion[];
  /** Confident enough to proceed on the default assumption without asking. */
  autoResolved: ClarificationQuestion[];
}

/**
 * Split questions by a confidence threshold: a question is asked when it's
 * `blocking` or its confidence is below `threshold`; otherwise it can proceed on
 * its default assumption. This is the "confidence thresholds" gate the
 * clarification loop (HELIX-95) uses to decide when to interrupt the user.
 */
export function triageByConfidence(
  questions: ClarificationQuestion[],
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): ClarificationTriage {
  const toAsk: ClarificationQuestion[] = [];
  const autoResolved: ClarificationQuestion[] = [];
  for (const q of questions) {
    if (q.importance === 'blocking' || q.confidence < threshold) toAsk.push(q);
    else autoResolved.push(q);
  }
  return { toAsk, autoResolved };
}

/** True if any question is blocking — the pipeline shouldn't proceed unanswered. */
export function hasBlockingQuestions(questions: ClarificationQuestion[]): boolean {
  return questions.some((q) => q.importance === 'blocking');
}

/**
 * Deterministic baseline (no LLM): turn the spec's free-text `openQuestions`
 * into structured questions. Useful as a fallback and to guarantee explicitly
 * open points become askable. Confidence 0 — these are, by definition, unknown.
 */
export function openQuestionsToClarifications(spec: RequirementsSpec): ClarificationQuestion[] {
  return spec.openQuestions.map((question, index) => ({
    id: `Q-${index + 1}`,
    topic: 'open question',
    question,
    importance: 'important' as const,
    confidence: 0,
  }));
}

function buildUserPrompt(spec: RequirementsSpec, requestText?: string): string {
  const parts = [
    'Review this requirements specification for ambiguities and generate clarification questions.',
    '',
    '<spec>',
    JSON.stringify(spec, null, 2),
    '</spec>',
  ];
  if (requestText?.trim()) {
    parts.push('', '<original_request>', requestText.trim(), '</original_request>');
  }
  return parts.join('\n');
}
