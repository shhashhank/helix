/**
 * Structured requirements specification (HELIX-93) — the Planning Agent's first
 * artifact. A natural-language request is turned into this shape, which then
 * feeds ambiguity detection / clarification (HELIX-94/95) and, ultimately, the
 * implementation plan that is the Coding Agent's input contract.
 *
 * Zod is the single source of truth: the TypeScript type, the runtime validator
 * for the model's output, and the JSON Schema handed to the LLM as a tool all
 * derive from `RequirementsSpecSchema`.
 */
import { z } from 'zod';

/** MoSCoW priorities for an individual requirement. */
export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could', 'wont'] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const RequirementSchema = z.object({
  id: z.string().min(1).describe('Stable identifier, e.g. "FR-1" or "NFR-2".'),
  description: z.string().min(1).describe('A single, concrete, testable requirement.'),
  priority: z.enum(REQUIREMENT_PRIORITIES).describe('MoSCoW priority.'),
  rationale: z.string().optional().describe('Why this requirement exists (optional).'),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const RequirementsSpecSchema = z.object({
  title: z.string().min(1).describe('A short title for what is being built.'),
  summary: z.string().min(1).describe('One-paragraph plain-language summary of the request.'),
  goals: z.array(z.string().min(1)).describe('What success looks like, in outcome terms.'),
  functionalRequirements: z.array(RequirementSchema).describe('What the system must do.'),
  nonFunctionalRequirements: z
    .array(RequirementSchema)
    .describe('Quality attributes: performance, security, reliability, UX, …'),
  constraints: z.array(z.string().min(1)).describe('Tech, time, budget, or regulatory constraints.'),
  assumptions: z
    .array(z.string().min(1))
    .describe('Anything inferred but not stated in the request — recorded, not presented as fact.'),
  outOfScope: z.array(z.string().min(1)).describe('Explicitly excluded work.'),
  openQuestions: z
    .array(z.string().min(1))
    .describe('Genuine gaps the request does not answer — for later clarification, do NOT invent.'),
  acceptanceCriteria: z
    .array(z.string().min(1))
    .describe('Objectively verifiable conditions that mark the work as done.'),
});
export type RequirementsSpec = z.infer<typeof RequirementsSpecSchema>;

/** JSON Schema for the spec, handed to the LLM as a tool's input schema. */
export const REQUIREMENTS_JSON_SCHEMA = z.toJSONSchema(RequirementsSpecSchema) as Record<
  string,
  unknown
>;

/** Thrown when a candidate spec (e.g. the model's tool output) fails validation. */
export class RequirementsValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid requirements spec: ${issues.join('; ')}`);
    this.name = 'RequirementsValidationError';
  }
}

/** Validate unknown input into a {@link RequirementsSpec}, or throw with the issues. */
export function parseRequirementsSpec(input: unknown): RequirementsSpec {
  const result = RequirementsSpecSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new RequirementsValidationError(issues);
  }
  return result.data;
}
