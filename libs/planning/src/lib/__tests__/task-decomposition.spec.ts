import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import { RequirementsSpec } from '../requirements';
import {
  decomposeTasks,
  TASK_PLAN_TOOL_NAME,
  TaskDecompositionError,
} from '../task-decomposition';
import {
  ImplementationTask,
  parseTaskPlan,
  TASK_PLAN_JSON_SCHEMA,
  TaskPlanValidationError,
  taskIds,
} from '../task-plan';

const spec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'Create and list notes.',
  goals: ['Persist notes'],
  functionalRequirements: [
    { id: 'FR-1', description: 'Create a note', priority: 'must' },
    { id: 'FR-2', description: 'List notes', priority: 'must' },
  ],
  nonFunctionalRequirements: [],
  constraints: [],
  assumptions: [],
  outOfScope: [],
  openQuestions: [],
  acceptanceCriteria: ['POST then GET returns the note'],
};

const tasks: ImplementationTask[] = [
  {
    id: 'T-1',
    title: 'Set up the notes table',
    description: 'Create the notes table + migration',
    category: 'data',
    dependsOn: [],
    requirementIds: ['FR-1'],
  },
  {
    id: 'T-2',
    title: 'Add create-note endpoint',
    description: 'POST /notes that persists a note',
    category: 'backend',
    dependsOn: ['T-1'],
    requirementIds: ['FR-1'],
  },
];

function fakeLlm(
  content: LlmContentPart[],
  onRequest?: (r: LlmCompletionRequest) => void,
): LlmProvider {
  return {
    name: 'fake',
    async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
      onRequest?.(request);
      return {
        model: 'claude-opus-4-8',
        stopReason: 'tool_use',
        content,
        text: '',
        usage: { inputTokens: 7, outputTokens: 14, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

const planTool = (input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id: 'tu_1',
  name: TASK_PLAN_TOOL_NAME,
  input,
});

describe('parseTaskPlan', () => {
  it('accepts a well-formed plan and exposes its task ids', () => {
    const parsed = parseTaskPlan({ tasks });
    expect(parsed).toEqual(tasks);
    expect(taskIds(parsed)).toEqual(['T-1', 'T-2']);
  });

  it('allows an empty plan', () => {
    expect(parseTaskPlan({ tasks: [] })).toEqual([]);
  });

  it('rejects an invalid category', () => {
    const bad = { tasks: [{ ...tasks[0], category: 'wizardry' }] };
    expect(() => parseTaskPlan(bad)).toThrow(TaskPlanValidationError);
  });

  it('rejects a task missing required fields', () => {
    expect(() => parseTaskPlan({ tasks: [{ id: 'T-1' }] })).toThrow(TaskPlanValidationError);
  });

  it('exposes a JSON schema with the plan shape', () => {
    expect(TASK_PLAN_JSON_SCHEMA.type).toBe('object');
    expect(Object.keys(TASK_PLAN_JSON_SCHEMA.properties as object)).toContain('tasks');
  });
});

describe('decomposeTasks', () => {
  it('forces the plan tool, embeds the spec, and returns validated tasks + usage', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm([planTool({ tasks })], (r) => (seen = r));

    const result = await decomposeTasks(spec, llm);

    expect(result.tasks).toEqual(tasks);
    expect(result.usage.outputTokens).toBe(14);
    expect(seen?.toolChoice).toEqual({ name: TASK_PLAN_TOOL_NAME });
    expect(seen?.system).toMatch(/tech lead/i);
    expect(JSON.stringify(seen?.messages)).toContain('Notes API');
  });

  it('passes through tier/effort/context', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm([planTool({ tasks })], (r) => (seen = r));
    await decomposeTasks(spec, llm, { tier: 'sonnet', effort: 'high', context: { runId: 'r1' } });
    expect(seen?.tier).toBe('sonnet');
    expect(seen?.effort).toBe('high');
    expect(seen?.context).toEqual({ runId: 'r1' });
  });

  it('throws when the model returns no tool call', async () => {
    const llm = fakeLlm([{ type: 'text', text: 'here is a plan...' }]);
    await expect(decomposeTasks(spec, llm)).rejects.toBeInstanceOf(TaskDecompositionError);
  });

  it('propagates a validation error for a malformed plan', async () => {
    const llm = fakeLlm([planTool({ tasks: [{ id: 'T-1' }] })]);
    await expect(decomposeTasks(spec, llm)).rejects.toBeInstanceOf(TaskPlanValidationError);
  });
});
