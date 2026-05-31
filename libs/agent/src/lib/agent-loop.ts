import type { LlmContentPart, LlmMessage } from '@helix/llm';
import {
  AgentRunResult,
  AgentStep,
  AgentStopReason,
  RunAgentOptions,
  ToolCall,
  ToolExecutor,
  ToolResult,
} from './types';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * The core agent loop (HELIX-58): reason → call tools → observe → repeat, until
 * the model ends its turn or the iteration cap is hit.
 *
 * Each turn calls the provider; if the model emitted `tool_use` blocks they're
 * executed and fed back as `tool_result`s, then the loop continues. With no
 * tool calls, the turn is final. Budget/guardrail enforcement (HELIX-59),
 * output validation (HELIX-60), and the event bus (HELIX-61) layer on top — the
 * loop exposes an `onStep` hook and an iteration cap as their seams.
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

  const messages: LlmMessage[] =
    typeof options.input === 'string'
      ? [{ role: 'user', content: options.input }]
      : [...options.input];

  const steps: AgentStep[] = [];

  for (let index = 0; index < maxIterations; index++) {
    const completion = await provider.complete({
      system: agent.system,
      tier: agent.tier,
      effort: agent.effort,
      maxTokens: agent.maxTokens,
      tools: agent.tools,
      messages,
      context,
    });

    // Record the assistant turn verbatim so tool_use ids round-trip.
    messages.push({ role: 'assistant', content: completion.content });

    const toolCalls = toToolCalls(completion.content);

    if (toolCalls.length === 0) {
      const step: AgentStep = { index, completion, toolCalls: [], toolResults: [] };
      steps.push(step);
      onStep?.(step);
      return finish(completion.stopReason ?? 'end_turn', completion, messages, steps, index + 1);
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

    const step: AgentStep = { index, completion, toolCalls, toolResults };
    steps.push(step);
    onStep?.(step);
  }

  // Iteration cap reached with the model still wanting to act.
  const last = steps[steps.length - 1].completion;
  return finish('max_iterations', last, messages, steps, maxIterations);
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
  last: AgentRunResult['steps'][number]['completion'],
  messages: LlmMessage[],
  steps: AgentStep[],
  iterations: number,
): AgentRunResult {
  return {
    finalText: last.text,
    finalContent: last.content,
    messages,
    steps,
    iterations,
    stopReason,
  };
}
