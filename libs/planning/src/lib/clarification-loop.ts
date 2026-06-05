/**
 * Clarification loop integration (HELIX-95): tie extraction (HELIX-93) and
 * ambiguity detection (HELIX-94) into one flow that **pauses for user answers**
 * and folds them back into the spec until it's confident enough to plan from.
 *
 * Each round: generate clarifications → triage by confidence → if anything must
 * be asked, hand those questions to an injected {@link ClarificationResponder}
 * (the "pause for the user" seam — a CLI prompt, an approval UI, a test stub),
 * then revise the spec with the answers. The seam is what keeps the loop fully
 * testable offline and lets the actual asking live wherever the host wants.
 */
import type {
  Effort,
  LlmCallContext,
  LlmProvider,
  LlmToolUsePart,
  LlmUsage,
  ModelTier,
} from '@helix/llm';
import {
  ClarificationQuestion,
  DEFAULT_CONFIDENCE_THRESHOLD,
  generateClarifications,
  triageByConfidence,
} from './clarification';
import { extractRequirements } from './requirement-extraction';
import {
  REQUIREMENTS_TOOL,
  REQUIREMENTS_TOOL_NAME,
  RequirementExtractionError,
} from './requirement-extraction';
import { parseRequirementsSpec, RequirementsSpec } from './requirements';

/** A user's answer to one clarification question. */
export interface ClarificationAnswer {
  /** Matches {@link ClarificationQuestion.id}. */
  id: string;
  answer: string;
}

/** Pairs a question with the answer it received. */
export interface AnsweredQuestion {
  question: ClarificationQuestion;
  answer: string;
}

/**
 * The "pause for the user" seam: given the must-ask questions, return answers.
 * Implemented by the host (CLI/UI); stubbed in tests. May answer a subset.
 */
export type ClarificationResponder = (
  questions: ClarificationQuestion[],
) => Promise<ClarificationAnswer[]>;

/** What happened in one round of the loop. */
export interface ClarificationRound {
  questionsAsked: ClarificationQuestion[];
  /** Confident enough to proceed on their default (not asked). */
  autoResolved: ClarificationQuestion[];
  answers: ClarificationAnswer[];
}

export interface ClarifiedRequirements {
  /** The final, refined spec. */
  spec: RequirementsSpec;
  /** One entry per round, in order. */
  rounds: ClarificationRound[];
  /** Aggregated LLM usage across the whole loop. */
  usage: LlmUsage;
}

export interface ClarificationLoopOptions {
  /** Required: how to pause and collect user answers. */
  responder: ClarificationResponder;
  /** Confidence threshold for triage (default {@link DEFAULT_CONFIDENCE_THRESHOLD}). */
  threshold?: number;
  /** Safety cap on rounds (default 3). */
  maxRounds?: number;
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

const emptyUsage = (): LlmUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
});

const addUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
});

/**
 * Run the clarification loop over a spec until no must-ask questions remain (or
 * `maxRounds` is hit), pausing for the user via `options.responder` each round.
 */
export async function clarifyRequirements(
  spec: RequirementsSpec,
  llm: LlmProvider,
  options: ClarificationLoopOptions,
): Promise<ClarifiedRequirements> {
  const threshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const maxRounds = options.maxRounds ?? 3;
  const llmOpts = { tier: options.tier, effort: options.effort, context: options.context };

  let current = spec;
  const rounds: ClarificationRound[] = [];
  let usage = emptyUsage();

  for (let round = 0; round < maxRounds; round++) {
    const generated = await generateClarifications(current, llm, llmOpts);
    usage = addUsage(usage, generated.usage);

    const { toAsk, autoResolved } = triageByConfidence(generated.questions, threshold);
    if (toAsk.length === 0) {
      rounds.push({ questionsAsked: [], autoResolved, answers: [] });
      break;
    }

    const answers = await options.responder(toAsk);
    rounds.push({ questionsAsked: toAsk, autoResolved, answers });

    const answered = joinAnswers(toAsk, answers);
    if (answered.length === 0) break; // user declined to answer — stop, don't spin

    const refined = await refineRequirements(current, answered, llm, {
      assumed: autoResolved,
      ...llmOpts,
    });
    usage = addUsage(usage, refined.usage);
    current = refined.spec;
  }

  return { spec: current, rounds, usage };
}

/**
 * Convenience entry for the whole Requirement Analysis pipeline: extract a spec
 * from the request (HELIX-93), then run the clarification loop (HELIX-94/95).
 */
export async function extractAndClarify(
  request: string,
  llm: LlmProvider,
  options: ClarificationLoopOptions,
): Promise<ClarifiedRequirements> {
  const { spec, usage } = await extractRequirements(request, llm, {
    tier: options.tier,
    effort: options.effort,
    context: options.context,
  });
  const clarified = await clarifyRequirements(spec, llm, options);
  return { ...clarified, usage: addUsage(usage, clarified.usage) };
}

export interface RefineRequirementsOptions {
  /** Questions auto-resolved on their default assumption — recorded in the spec. */
  assumed?: ClarificationQuestion[];
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

/**
 * Revise a spec by folding in answers to clarification questions (and any
 * auto-applied default assumptions). Reuses the requirements tool/schema so the
 * result is a fully validated {@link RequirementsSpec}.
 */
export async function refineRequirements(
  spec: RequirementsSpec,
  answered: AnsweredQuestion[],
  llm: LlmProvider,
  options: RefineRequirementsOptions = {},
): Promise<{ spec: RequirementsSpec; model: string; usage: LlmUsage }> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: REQUIREMENT_REFINEMENT_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: buildRefinementPrompt(spec, answered, options.assumed ?? []) },
    ],
    tools: [REQUIREMENTS_TOOL],
    toolChoice: { name: REQUIREMENTS_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (part): part is LlmToolUsePart =>
      part.type === 'tool_use' && part.name === REQUIREMENTS_TOOL_NAME,
  );
  if (!toolUse) {
    throw new RequirementExtractionError(
      `model did not return a refined spec via ${REQUIREMENTS_TOOL_NAME}`,
      completion,
    );
  }
  return {
    spec: parseRequirementsSpec(toolUse.input),
    model: completion.model,
    usage: completion.usage,
  };
}

export const REQUIREMENT_REFINEMENT_SYSTEM_PROMPT = [
  'You are refining a requirements specification using answers to clarification questions.',
  `Produce an updated, complete spec by calling the ${REQUIREMENTS_TOOL_NAME} tool exactly once.`,
  '',
  '- Incorporate every answer: move now-resolved items out of openQuestions and adjust the',
  '  affected requirements, constraints, and acceptance criteria accordingly.',
  '- Record any auto-applied default assumptions under assumptions.',
  '- Preserve all still-valid detail from the current spec; do not drop requirements.',
  '- Do not expand scope beyond what the answers establish.',
].join('\n');

function joinAnswers(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
): AnsweredQuestion[] {
  const byId = new Map(answers.map((a) => [a.id, a.answer]));
  return questions
    .filter((q) => byId.has(q.id))
    .map((q) => ({ question: q, answer: byId.get(q.id) as string }));
}

function buildRefinementPrompt(
  spec: RequirementsSpec,
  answered: AnsweredQuestion[],
  assumed: ClarificationQuestion[],
): string {
  const parts = [
    'Update this requirements specification using the clarification answers below.',
    '',
    '<spec>',
    JSON.stringify(spec, null, 2),
    '</spec>',
    '',
    '<answers>',
    ...answered.map((a) => `- [${a.question.topic}] ${a.question.question}\n  Answer: ${a.answer}`),
    '</answers>',
  ];
  if (assumed.length > 0) {
    parts.push(
      '',
      '<auto_resolved_assumptions>',
      ...assumed.map(
        (q) => `- [${q.topic}] ${q.question}\n  Assumed: ${q.defaultAssumption ?? '(use a sensible default)'}`,
      ),
      '</auto_resolved_assumptions>',
    );
  }
  return parts.join('\n');
}
