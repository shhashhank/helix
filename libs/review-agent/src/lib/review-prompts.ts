/**
 * Multi-aspect review prompts (HELIX-112): run the assembled {@link ReviewContext}
 * through the model as focused, single-aspect passes — correctness, security,
 * style, performance, and plan-conformance — each with its own "what to look for"
 * guidance. Splitting the review by aspect keeps each pass focused and catches
 * more than one catch-all prompt.
 *
 * This produces the model's review text per aspect; the structured findings
 * schema + severity model is HELIX-113. The LLM is injected, so prompt
 * construction is deterministic and the runner is offline-testable with a fake.
 */
import type { Effort, LlmCallContext, LlmProvider, LlmUsage, ModelTier } from '@helix/llm';
import { formatReviewContext, ReviewContext } from './review-context';

export const REVIEW_ASPECTS = [
  'correctness',
  'security',
  'style',
  'performance',
  'plan-conformance',
] as const;
export type ReviewAspect = (typeof REVIEW_ASPECTS)[number];

/** What each aspect's pass should look for. */
export const ASPECT_GUIDANCE: Record<ReviewAspect, string> = {
  correctness:
    'logic errors, bugs, unhandled edge cases, incorrect error handling, broken or missing contracts',
  security:
    'injection, missing authn/authz, secrets committed in code, unsafe input handling, path traversal, SSRF',
  style:
    'readability, naming, consistency with the codebase conventions, dead code — only where it materially matters',
  performance: 'obvious inefficiencies, N+1 queries, needless work in hot paths, unbounded memory/IO',
  'plan-conformance':
    'whether the change actually implements the spec/plan — missing requirements, scope creep, or mismatches',
};

/** Build the single-aspect reviewer system prompt. */
export function buildAspectSystemPrompt(aspect: ReviewAspect): string {
  return [
    `You are a senior code reviewer doing a focused ${aspect.replace('-', ' ')} review.`,
    `Look specifically for: ${ASPECT_GUIDANCE[aspect]}.`,
    'Report only real, actionable issues — do not nitpick or invent problems; if there are none, say so plainly.',
    'Reference the specific file and the relevant lines from the diff for each issue.',
  ].join('\n');
}

export interface ReviewAspectOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

export interface AspectReview {
  aspect: ReviewAspect;
  /** The model's review text for this aspect. */
  review: string;
  model: string;
  usage: LlmUsage;
}

/** Run a single-aspect review pass. */
export async function reviewAspect(
  context: ReviewContext,
  aspect: ReviewAspect,
  llm: LlmProvider,
  options: ReviewAspectOptions = {},
): Promise<AspectReview> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: buildAspectSystemPrompt(aspect),
    messages: [{ role: 'user', content: buildUserPrompt(context) }],
    context: options.context,
  });
  return { aspect, review: completion.text, model: completion.model, usage: completion.usage };
}

export interface ReviewAspectsOptions extends ReviewAspectOptions {
  /** Which aspects to review (default: all of {@link REVIEW_ASPECTS}). */
  aspects?: ReviewAspect[];
}

/** Run the review across several aspects, in order. */
export async function reviewAspects(
  context: ReviewContext,
  llm: LlmProvider,
  options: ReviewAspectsOptions = {},
): Promise<AspectReview[]> {
  const aspects = options.aspects ?? [...REVIEW_ASPECTS];
  const reviews: AspectReview[] = [];
  for (const aspect of aspects) {
    reviews.push(await reviewAspect(context, aspect, llm, options));
  }
  return reviews;
}

function buildUserPrompt(context: ReviewContext): string {
  return ['Review the following change:', '', formatReviewContext(context)].join('\n');
}
