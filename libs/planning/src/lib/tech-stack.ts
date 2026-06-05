/**
 * Tech-stack + scaffold selection (HELIX-98) — the last piece of the
 * implementation plan. Given the agreed {@link RequirementsSpec} (and optionally
 * the task plan), choose a coherent technology stack and a minimal initial
 * project scaffold, grounded in the spec's constraints and non-functional
 * requirements. Same reliability pattern as the rest of planning: a forced tool
 * call returns structured output validated against the schema before we trust it.
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
import { ImplementationTask } from './task-plan';

/** A single technology decision, e.g. area "backend framework" → choice "NestJS". */
export const TechChoiceSchema = z.object({
  area: z
    .string()
    .min(1)
    .describe('The decision area, e.g. "backend framework", "database", "testing".'),
  choice: z.string().min(1).describe('The selected technology, e.g. "NestJS", "PostgreSQL".'),
  rationale: z.string().min(1).optional().describe('Why this choice, esp. vs alternatives.'),
});
export type TechChoice = z.infer<typeof TechChoiceSchema>;

/** One entry in the initial project scaffold. */
export const ScaffoldEntrySchema = z.object({
  path: z.string().min(1).describe('Repo-relative path, e.g. "src/" or "src/main.ts".'),
  kind: z.enum(['dir', 'file']),
  description: z.string().min(1).optional().describe('What lives here.'),
});
export type ScaffoldEntry = z.infer<typeof ScaffoldEntrySchema>;

export const TechStackSelectionSchema = z.object({
  language: z.string().min(1).describe('Primary language, e.g. "TypeScript".'),
  runtime: z.string().min(1).describe('Runtime/platform, e.g. "Node.js 22".'),
  choices: z
    .array(TechChoiceSchema)
    .describe('The rest of the stack: frameworks, datastore, testing, package manager, etc.'),
  dependencies: z.array(z.string().min(1)).describe('Key packages to install.'),
  scaffold: z.array(ScaffoldEntrySchema).describe('Minimal initial directory/file layout.'),
  setupCommands: z
    .array(z.string().min(1))
    .describe('Commands to scaffold/initialise the project, e.g. "pnpm add @nestjs/core".'),
  notes: z.array(z.string().min(1)).describe('Assumptions and notable decisions.'),
});
export type TechStackSelection = z.infer<typeof TechStackSelectionSchema>;

export const TECH_STACK_JSON_SCHEMA = z.toJSONSchema(TechStackSelectionSchema) as Record<
  string,
  unknown
>;

export class TechStackValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid tech-stack selection: ${issues.join('; ')}`);
    this.name = 'TechStackValidationError';
  }
}

/** Validate unknown input into a {@link TechStackSelection}, or throw. */
export function parseTechStackSelection(input: unknown): TechStackSelection {
  const result = TechStackSelectionSchema.safeParse(input);
  if (!result.success) {
    throw new TechStackValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

export const TECH_STACK_TOOL_NAME = 'emit_tech_stack';

export const TECH_STACK_TOOL: LlmToolDef = {
  name: TECH_STACK_TOOL_NAME,
  description:
    'Return the chosen technology stack and the minimal initial project scaffold. Call exactly once.',
  inputSchema: TECH_STACK_JSON_SCHEMA,
};

export const TECH_STACK_SYSTEM_PROMPT = [
  'You are a senior software architect choosing the technology stack and the initial project',
  `scaffold for a build by calling the ${TECH_STACK_TOOL_NAME} tool exactly once.`,
  '',
  'Guidelines:',
  '- Ground every choice in the spec: honour stated constraints (existing infrastructure, regulatory,',
  '  performance) and the non-functional requirements. A constraint always wins over preference.',
  '- Pick a coherent, conventional, well-supported stack — language, runtime, the relevant frameworks,',
  '  datastore, testing, and package manager. Prefer mainstream choices; do not over-engineer.',
  '- List the key dependencies to install and a minimal initial scaffold (directories + key files) —',
  '  just enough to start building, not the whole tree.',
  '- Record assumptions and notable trade-offs under notes. Do not introduce scope beyond the spec.',
].join('\n');

export interface SelectTechStackOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
  /** The task plan, for extra grounding (optional). */
  tasks?: ImplementationTask[];
}

export interface TechStackResult {
  selection: TechStackSelection;
  model: string;
  usage: LlmUsage;
}

export class TechStackSelectionError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'TechStackSelectionError';
  }
}

/**
 * Choose a tech stack + scaffold for the spec. Throws {@link TechStackSelectionError}
 * if the model returns no tool call, and {@link TechStackValidationError} if the
 * returned selection is malformed.
 */
export async function selectTechStack(
  spec: RequirementsSpec,
  llm: LlmProvider,
  options: SelectTechStackOptions = {},
): Promise<TechStackResult> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: TECH_STACK_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(spec, options.tasks) }],
    tools: [TECH_STACK_TOOL],
    toolChoice: { name: TECH_STACK_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (part): part is LlmToolUsePart =>
      part.type === 'tool_use' && part.name === TECH_STACK_TOOL_NAME,
  );
  if (!toolUse) {
    throw new TechStackSelectionError(
      `model did not call ${TECH_STACK_TOOL_NAME}; cannot select a tech stack`,
      completion,
    );
  }

  return {
    selection: parseTechStackSelection(toolUse.input),
    model: completion.model,
    usage: completion.usage,
  };
}

function buildUserPrompt(spec: RequirementsSpec, tasks?: ImplementationTask[]): string {
  const parts = [
    'Choose the technology stack and initial scaffold for this requirements specification.',
    '',
    '<spec>',
    JSON.stringify(spec, null, 2),
    '</spec>',
  ];
  if (tasks?.length) {
    parts.push('', '<tasks>', JSON.stringify(tasks, null, 2), '</tasks>');
  }
  return parts.join('\n');
}
