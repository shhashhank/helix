/**
 * Implementation task plan (HELIX-96) — the **nodes of the task graph**.
 *
 * The agreed requirements spec is decomposed into concrete, independently
 * implementable engineering tasks. Each task declares the requirements it
 * implements (traceability) and the tasks it depends on (the graph edges).
 * HELIX-97 validates those edges into a DAG and orders them; HELIX-98 picks the
 * tech/scaffold. As with the spec, Zod is the single source of truth for the
 * type, the runtime validator, and the JSON Schema given to the LLM.
 */
import { z } from 'zod';

/** Coarse category for a task, useful for grouping/scheduling. */
export const TASK_CATEGORIES = [
  'setup',
  'backend',
  'frontend',
  'data',
  'integration',
  'testing',
  'docs',
  'infra',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const ImplementationTaskSchema = z.object({
  id: z.string().min(1).describe('Stable id, e.g. "T-1".'),
  title: z.string().min(1).describe('Short imperative title, e.g. "Add note creation endpoint".'),
  description: z.string().min(1).describe('What to build, concretely enough to implement.'),
  category: z.enum(TASK_CATEGORIES).describe('Coarse category for grouping.'),
  dependsOn: z
    .array(z.string().min(1))
    .describe('Ids of tasks that must be completed first (the graph edges).'),
  requirementIds: z
    .array(z.string().min(1))
    .describe('Spec requirement ids (FR-*/NFR-*) this task implements, for traceability.'),
  rationale: z.string().min(1).optional().describe('Why this task exists (optional).'),
});
export type ImplementationTask = z.infer<typeof ImplementationTaskSchema>;

export const TaskPlanSchema = z.object({
  tasks: z.array(ImplementationTaskSchema),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

/** JSON Schema for the plan, handed to the LLM as a tool's input schema. */
export const TASK_PLAN_JSON_SCHEMA = z.toJSONSchema(TaskPlanSchema) as Record<string, unknown>;

export class TaskPlanValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid task plan: ${issues.join('; ')}`);
    this.name = 'TaskPlanValidationError';
  }
}

/** Validate unknown input into a list of {@link ImplementationTask}, or throw. */
export function parseTaskPlan(input: unknown): ImplementationTask[] {
  const result = TaskPlanSchema.safeParse(input);
  if (!result.success) {
    throw new TaskPlanValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data.tasks;
}

/** The set of task ids in a plan. */
export function taskIds(tasks: ImplementationTask[]): string[] {
  return tasks.map((t) => t.id);
}
