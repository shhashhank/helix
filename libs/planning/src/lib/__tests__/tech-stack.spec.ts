import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import { RequirementsSpec } from '../requirements';
import { ImplementationTask } from '../task-plan';
import {
  parseTechStackSelection,
  selectTechStack,
  TECH_STACK_JSON_SCHEMA,
  TECH_STACK_TOOL_NAME,
  TechStackSelection,
  TechStackSelectionError,
  TechStackValidationError,
} from '../tech-stack';

const spec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'Create and list notes.',
  goals: ['Persist notes'],
  functionalRequirements: [{ id: 'FR-1', description: 'Create a note', priority: 'must' }],
  nonFunctionalRequirements: [],
  constraints: ['Must run on the existing Postgres instance'],
  assumptions: [],
  outOfScope: [],
  openQuestions: [],
  acceptanceCriteria: ['POST then GET returns the note'],
};

const selection: TechStackSelection = {
  language: 'TypeScript',
  runtime: 'Node.js 22',
  choices: [
    { area: 'backend framework', choice: 'NestJS', rationale: 'Matches the existing platform' },
    { area: 'database', choice: 'PostgreSQL', rationale: 'Mandated by the constraint' },
    { area: 'testing', choice: 'Jest' },
  ],
  dependencies: ['@nestjs/core', '@nestjs/common', 'prisma'],
  scaffold: [
    { path: 'src/', kind: 'dir', description: 'Application source' },
    { path: 'src/main.ts', kind: 'file', description: 'Bootstrap' },
  ],
  setupCommands: ['pnpm add @nestjs/core @nestjs/common'],
  notes: ['Postgres chosen to satisfy the existing-instance constraint'],
};

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
        usage: { inputTokens: 9, outputTokens: 18, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

const stackTool = (input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id: 'tu_1',
  name: TECH_STACK_TOOL_NAME,
  input,
});

describe('parseTechStackSelection', () => {
  it('accepts a well-formed selection', () => {
    expect(parseTechStackSelection(structuredClone(selection))).toEqual(selection);
  });

  it('rejects an invalid scaffold kind', () => {
    const bad = structuredClone(selection);
    (bad.scaffold[0] as { kind: string }).kind = 'folder';
    expect(() => parseTechStackSelection(bad)).toThrow(TechStackValidationError);
  });

  it('rejects a missing required field (language)', () => {
    const { language, ...rest } = selection;
    void language;
    expect(() => parseTechStackSelection(rest)).toThrow(TechStackValidationError);
  });

  it('exposes a JSON schema object', () => {
    expect(TECH_STACK_JSON_SCHEMA.type).toBe('object');
    expect(Object.keys(TECH_STACK_JSON_SCHEMA.properties as object)).toEqual(
      expect.arrayContaining(['language', 'runtime', 'scaffold', 'dependencies']),
    );
  });
});

describe('selectTechStack', () => {
  it('forces the stack tool, embeds the spec, and returns the validated selection + usage', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm([stackTool(selection)], (r) => (seen = r));

    const result = await selectTechStack(spec, llm);

    expect(result.selection).toEqual(selection);
    expect(result.usage.outputTokens).toBe(18);
    expect(seen?.toolChoice).toEqual({ name: TECH_STACK_TOOL_NAME });
    expect(seen?.system).toMatch(/architect/i);
    expect(JSON.stringify(seen?.messages)).toContain('existing Postgres');
  });

  it('embeds the task plan when provided', async () => {
    let seen: LlmCompletionRequest | undefined;
    const tasks: ImplementationTask[] = [
      { id: 'T-1', title: 'Schema', description: 'notes table', category: 'data', dependsOn: [], requirementIds: ['FR-1'] },
    ];
    const llm = fakeLlm([stackTool(selection)], (r) => (seen = r));
    await selectTechStack(spec, llm, { tasks });
    expect(JSON.stringify(seen?.messages)).toContain('notes table');
  });

  it('throws when the model returns no tool call', async () => {
    const llm = fakeLlm([{ type: 'text', text: 'use NestJS' }]);
    await expect(selectTechStack(spec, llm)).rejects.toBeInstanceOf(TechStackSelectionError);
  });

  it('propagates a validation error for a malformed selection', async () => {
    const llm = fakeLlm([stackTool({ language: 'TypeScript' })]);
    await expect(selectTechStack(spec, llm)).rejects.toBeInstanceOf(TechStackValidationError);
  });
});
