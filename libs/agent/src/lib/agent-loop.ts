import type { LlmCompletion, LlmContentPart, LlmMessage } from '@helix/llm';
import { GuardrailMonitor } from './guardrails';
import {
  AgentRunResult,
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
 * Guardrails (HELIX-59) — max steps, token/cost ceilings, and repeated-tool-call
 * loop detection — are enforced via {@link GuardrailMonitor}: the loop records
 * each turn and stops with the matching reason + breach when a limit is crossed.
 * Output validation (HELIX-60) and the event bus (HELIX-61) layer on top via the
 * `onStep` hook and the raw final content.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const {
    provider,
    agent,
    executors = {},
    maxIterations = DEFAULT_MAX_ITERATIONS,
    context,
    onStep,
  } = options;

  const monitor = new GuardrailMonitor(options.guardrails ?? { loopDetection: false });
  const messages: LlmMessage[] =
    typeof options.input === 'string'
      ? [{ role: 'user', content: options.input }]
      : [...options.input];

  const steps: AgentStep[] = [];
  let last: LlmCompletion | undefined;

  for (let index = 0; index < maxIterations; index++) {
    const stepBreach = monitor.stepBreach(index);
    if (stepBreach) {
      return finish('max_steps', last, messages, steps, index, monitor, stepBreach);
    }

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

    const toolCalls = toToolCalls(completion.content);

    // Model ended its turn — natural completion wins over any budget state.
    if (toolCalls.length === 0) {
      pushStep(steps, onStep, { index, completion, toolCalls: [], toolResults: [] });
      return finish(completion.stopReason ?? 'end_turn', completion, messages, steps, index + 1, monitor);
    }

    // Token / cost ceiling — stop after this turn, before doing more work.
    const budget = monitor.budgetBreach();
    if (budget) {
      pushStep(steps, onStep, { index, completion, toolCalls, toolResults: [] });
      return finish(budget.type, completion, messages, steps, index + 1, monitor, budget);
    }

    // Loop detection — stop before re-running the repeated tools.
    const loop = monitor.loopBreach(toolCalls);
    if (loop) {
      pushStep(steps, onStep, { index, completion, toolCalls, toolResults: [] });
      return finish('loop_detected', completion, messages, steps, index + 1, monitor, loop);
    }

    const toolResults: { call: ToolCall; result: ToolResult }[] = [];
    const resultParts: LlmContentPart[] = [];
    for (const call of toolCalls) {
      const result = await runTool(executors[call.name], call);
      toolResults.push({ call, result });
      resultParts.push({
        type: 'tool_result',
        toolUseId: call.id,
        content: result.content,
        isError: result.isError,
      });
    }
    messages.push({ role: 'user', content: resultParts });
    pushStep(steps, onStep, { index, completion, toolCalls, toolResults });
  }

  return finish('max_iterations', last, messages, steps, maxIterations, monitor);
}

function pushStep(steps: AgentStep[], onStep: RunAgentOptions['onStep'], step: AgentStep): void {
  steps.push(step);
  onStep?.(step);
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
  breach?: GuardrailBreach,
): AgentRunResult {
  return {
    finalText: last?.text ?? '',
    finalContent: last?.content ?? [],
    messages,
    steps,
    iterations,
    stopReason,
    breach,
    totals: { tokens: monitor.tokens, costUsd: monitor.costUsd },
  };
}
