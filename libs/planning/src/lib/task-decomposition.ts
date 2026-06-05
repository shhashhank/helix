/**
 * Task decomposition (HELIX-96): drive the LLM to break a {@link RequirementsSpec}
 * into a structured {@link TaskPlan} — the nodes (and declared dependency edges)
 * of the implementation plan. Same reliability pattern as the other planning
 * steps: a forced tool call returns structured output that is validated against
 * the schema before we trust it.
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
import { RequirementsSpec } from './requirements';
import {
  ImplementationTask,
  parseTaskPlan,
  TASK_PLAN_JSON_SCHEMA,
} from './task-plan';

export const TASK_PLAN_TOOL_NAME = 'emit_task_plan';

export const TASK_PLAN_TOOL: LlmToolDef = {
  name: TASK_PLAN_TOOL_NAME,
  description:
    'Return the implementation task plan decomposed from the requirements spec. Call this exactly once.',
  inputSchema: TASK_PLAN_JSON_SCHEMA,
};

export const TASK_DECOMPOSITION_SYSTEM_PROMPT = [
  'You are a senior tech lead breaking a requirements specification into a set of concrete,',
  `independently implementable engineering tasks by calling the ${TASK_PLAN_TOOL_NAME} tool exactly once.`,
  '',
  'Guidelines:',
  '- Each task should be small enough to implement and review as one focused unit of work.',
  '- Give each a stable id, an imperative title, a concrete description, and a category.',
  '- Set requirementIds to the spec requirement ids (FR-*/NFR-*) the task implements — together the',
  '  tasks must cover every functional and non-functional requirement.',
  '- Express ordering only through dependsOn (ids of tasks that must come first), not list order;',
  '  keep dependencies minimal and acyclic. A task with no prerequisites has an empty dependsOn.',
  '- Do not invent scope beyond the spec, and do not collapse unrelated work into one task.',
].join('\n');

export interface DecomposeTasksOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

export interface TaskDecomposition {
  tasks: ImplementationTask[];
  model: string;
  usage: LlmUsage;
}

export class TaskDecompositionError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'TaskDecompositionError';
  }
}

/**
 * Decompose a requirements spec into a validated set of implementation tasks.
 * Throws {@link TaskDecompositionError} if the model returns no tool call, and
 * {@link TaskPlanValidationError} if the returned plan is malformed.
 */
export async function decomposeTasks(
  spec: RequirementsSpec,
  llm: LlmProvider,
  options: DecomposeTasksOptions = {},
): Promise<TaskDecomposition> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: TASK_DECOMPOSITION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(spec) }],
    tools: [TASK_PLAN_TOOL],
    toolChoice: { name: TASK_PLAN_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (part): part is LlmToolUsePart => part.type === 'tool_use' && part.name === TASK_PLAN_TOOL_NAME,
  );
  if (!toolUse) {
    throw new TaskDecompositionError(
      `model did not call ${TASK_PLAN_TOOL_NAME}; cannot decompose tasks`,
      completion,
    );
  }

  return {
    tasks: parseTaskPlan(toolUse.input),
    model: completion.model,
    usage: completion.usage,
  };
}

function buildUserPrompt(spec: RequirementsSpec): string {
  return [
    'Decompose this requirements specification into an implementation task plan.',
    '',
    '<spec>',
    JSON.stringify(spec, null, 2),
    '</spec>',
  ].join('\n');
}
