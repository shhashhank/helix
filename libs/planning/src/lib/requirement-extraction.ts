/**
 * Requirement extraction (HELIX-93): drive the LLM to convert a natural-language
 * request into a validated {@link RequirementsSpec}.
 *
 * Structured output is obtained the reliable way for this provider — a **forced
 * tool call**: the spec's JSON Schema is exposed as a single tool and the model
 * is required to call it, so the answer arrives as structured `tool_use` input
 * rather than free-form prose we'd have to scrape. The tool input is then
 * validated against the same schema before we trust it.
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
import {
  parseRequirementsSpec,
  REQUIREMENTS_JSON_SCHEMA,
  RequirementsSpec,
} from './requirements';

export const REQUIREMENTS_TOOL_NAME = 'emit_requirements_spec';

/** The single tool the model must call to return the structured spec. */
export const REQUIREMENTS_TOOL: LlmToolDef = {
  name: REQUIREMENTS_TOOL_NAME,
  description:
    'Return the structured requirements specification extracted from the request. Call this exactly once.',
  inputSchema: REQUIREMENTS_JSON_SCHEMA,
};

export const REQUIREMENT_EXTRACTION_SYSTEM_PROMPT = [
  'You are a senior requirements analyst. Convert the user request into a complete,',
  `structured requirements specification by calling the ${REQUIREMENTS_TOOL_NAME} tool exactly once.`,
  '',
  'Guidelines:',
  '- Capture concrete, testable functional requirements and the relevant non-functional',
  '  requirements (performance, security, reliability, UX), each with a stable id and a',
  '  MoSCoW priority (must/should/could/wont).',
  '- State the goals (what success looks like) and acceptance criteria (objectively',
  '  verifiable conditions for "done").',
  '- Make every inference explicit: if you assume something the request did not state,',
  '  record it under assumptions rather than presenting it as established fact.',
  '- Do NOT invent details to fill genuine gaps. Anything you cannot determine from the',
  '  request goes under openQuestions for later clarification.',
  '- List real constraints (tech, time, budget, regulatory) and what is explicitly out of scope.',
  '- Stay faithful to the request; do not expand scope beyond what is asked or clearly implied.',
].join('\n');

export interface ExtractRequirementsOptions {
  /** Model tier (default `opus`). */
  tier?: ModelTier;
  /** Reasoning effort, when the tier supports it. */
  effort?: Effort;
  /** Attribution for usage metering. */
  context?: LlmCallContext;
}

export interface RequirementExtraction {
  spec: RequirementsSpec;
  /** The model that produced the spec. */
  model: string;
  usage: LlmUsage;
}

/** Thrown when the model doesn't return a usable spec (no tool call). */
export class RequirementExtractionError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'RequirementExtractionError';
  }
}

/**
 * Extract a validated requirements spec from a natural-language `request`.
 * Throws {@link RequirementExtractionError} if the model returns no spec, and
 * {@link RequirementsValidationError} if the returned spec is malformed.
 */
export async function extractRequirements(
  request: string,
  llm: LlmProvider,
  options: ExtractRequirementsOptions = {},
): Promise<RequirementExtraction> {
  const text = request.trim();
  if (!text) {
    throw new RequirementExtractionError('request text is empty');
  }

  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: REQUIREMENT_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(text) }],
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
      `model did not call ${REQUIREMENTS_TOOL_NAME}; cannot extract requirements`,
      completion,
    );
  }

  return {
    spec: parseRequirementsSpec(toolUse.input),
    model: completion.model,
    usage: completion.usage,
  };
}

function buildUserPrompt(request: string): string {
  return [
    'Extract a complete requirements specification from the following request.',
    '',
    '<request>',
    request,
    '</request>',
  ].join('\n');
}
