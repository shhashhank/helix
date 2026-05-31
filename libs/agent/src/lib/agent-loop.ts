import type { LlmCompletion, LlmContentPart, LlmMessage } from '@helix/llm';
import type { AgentEvent } from './events';
import { GuardrailMonitor } from './guardrails';
import { validateOutput } from './output';
import {
  AgentRunResult,
  AgentSpec,
  AgentStep,
  AgentStopReason,
  GuardrailBreach,
  RunAgentOptions,
  ToolCall,
  ToolExecutor,
  ToolResult,
} from './types';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * The core agent loop (HELIX-58): reason → call tools → observe → repeat, until
 * the model ends its turn, the iteration cap is hit, or a guardrail trips.
 *
 * Guardrails (HELIX-59) bound the run; final output is coerced + validated
 * against `agent.outputSchema` (HELIX-60); and `agent.*` lifecycle events stream
 * to `onEvent` as the run progresses (HELIX-61).
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const {
    provider,
    agent,
    executors = {},
    maxIterations = DEFAULT_MAX_ITERATIONS,
    context,
    onStep,
    onEvent,
  } = options;

  const monitor = new GuardrailMonitor(options.guardrails ?? { loopDetection: false });
  const messages: LlmMessage[] =
    typeof options.input === 'string'
      ? [{ role: 'user', content: options.input }]
      : [...options.input];

  const steps: AgentStep[] = [];
  let last: LlmCompletion | undefined;

  const emit = (event: AgentEvent): void => onEvent?.(event);
  const endStep = (step: AgentStep): void => {
    steps.push(step);
    onStep?.(step);
    emit({ type: 'agent.step.end', index: step.index, toolCalls: step.toolCalls, at: new Date() });
  };
  const done = (result: AgentRunResult): AgentRunResult => {
    emit({
      type: 'agent.run.end',
      stopReason: result.stopReason,
      iterations: result.iterations,
      totals: result.totals,
      breach: result.breach,
      at: new Date(),
    });
    return result;
  };

  emit({ type: 'agent.run.start', at: new Date() });

  for (let index = 0; index < maxIterations; index++) {
    const stepBreach = monitor.stepBreach(index);
    if (stepBreach) {
      return done(finish('max_steps', last, messages, steps, index, monitor, agent.outputSchema, stepBreach));
    }

    emit({ type: 'agent.step.start', index, at: new Date() });
    const completion = await provider.complete({
      system: agent.system,
      tier: agent.tier,
      effort: agent.effort,
      maxTokens: agent.maxTokens,
      tools: agent.tools,
      messages,
      context,
    });
    last = completion;
    messages.push({ role: 'assistant', content: completion.content });
    monitor.recordCompletion(completion);
    emit({
      type: 'agent.model.response',
      index,
      model: completion.model,
      usage: completion.usage,
      stopReason: completion.stopReason,
      at: new Date(),
    });

    const toolCalls = toToolCalls(completion.content);

    // Model ended its turn — natural completion wins over any budget state.
    if (toolCalls.length === 0) {
      endStep({ index, completion, toolCalls: [], toolResults: [] });
      return done(finish(completion.stopReason ?? 'end_turn', completion, messages, steps, index + 1, monitor, agent.outputSchema));
    }

    // Token / cost ceiling — stop after this turn, before doing more work.
    const budget = monitor.budgetBreach();
    if (budget) {
      endStep({ index, completion, toolCalls, toolResults: [] });
      return done(finish(budget.type, completion, messages, steps, index + 1, monitor, agent.outputSchema, budget));
    }

    // Loop detection — stop before re-running the repeated tools.
    const loop = monitor.loopBreach(toolCalls);
    if (loop) {
      endStep({ index, completion, toolCalls, toolResults: [] });
      return done(finish('loop_detected', completion, messages, steps, index + 1, monitor, agent.outputSchema, loop));
    }

    const toolResults: { call: ToolCall; result: ToolResult }[] = [];
    const resultParts: LlmContentPart[] = [];
    for (const call of toolCalls) {
      emit({ type: 'agent.tool.start', index, call, at: new Date() });
      const result = await runTool(executors[call.name], call);
      emit({ type: 'agent.tool.result', index, call, result, at: new Date() });
      toolResults.push({ call, result });
      resultParts.push({
        type: 'tool_result',
        toolUseId: call.id,
        content: result.content,
        isError: result.isError,
      });
    }
    messages.push({ role: 'user', content: resultParts });
    endStep({ index, completion, toolCalls, toolResults });
  }

  return done(finish('max_iterations', last, messages, steps, maxIterations, monitor, agent.outputSchema));
}

function toToolCalls(content: LlmContentPart[]): ToolCall[] {
  return content
    .filter((b): b is Extract<LlmContentPart, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

async function runTool(executor: ToolExecutor | undefined, call: ToolCall): Promise<ToolResult> {
  if (!executor) {
    return { content: `no executor registered for tool "${call.name}"`, isError: true };
  }
  try {
    return await executor(call);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function finish(
  stopReason: AgentStopReason,
  last: LlmCompletion | undefined,
  messages: LlmMessage[],
  steps: AgentStep[],
  iterations: number,
  monitor: GuardrailMonitor,
  outputSchema: AgentSpec['outputSchema'],
  breach?: GuardrailBreach,
): AgentRunResult {
  const finalText = last?.text ?? '';
  return {
    finalText,
    finalContent: last?.content ?? [],
    messages,
    steps,
    iterations,
    stopReason,
    breach,
    totals: { tokens: monitor.tokens, costUsd: monitor.costUsd },
    output: outputSchema ? validateOutput(finalText, outputSchema) : undefined,
  };
}
