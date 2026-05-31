import { estimateCostUsd, getPricing } from '@helix/llm';
import type { LlmCompletion, LlmUsage } from '@helix/llm';
import { GuardrailBreach, Guardrails, ToolCall } from './types';

const DEFAULT_LOOP_WINDOW = 3;

function totalTokens(usage: LlmUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

/** A stable signature for a set of tool calls (order-independent). */
function signatureOf(calls: ToolCall[]): string {
  return JSON.stringify(
    calls
      .map((c) => ({ name: c.name, input: c.input }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/**
 * Accumulates a run's usage/cost and watches for guardrail breaches (HELIX-59):
 * max steps, token ceiling, cost ceiling, and repeated-tool-call loops. The loop
 * records each turn and asks the monitor whether to stop.
 */
export class GuardrailMonitor {
  tokens = 0;
  costUsd = 0;
  private readonly loopWindow: number | null;
  private lastSignature: string | null = null;
  private repeats = 0;

  constructor(private readonly rails: Guardrails) {
    const ld = rails.loopDetection;
    this.loopWindow =
      ld === false || ld === undefined
        ? ld === undefined
          ? DEFAULT_LOOP_WINDOW // default on when guardrails present but unspecified
          : null
        : ld === true
          ? DEFAULT_LOOP_WINDOW
          : (ld.windowSize ?? DEFAULT_LOOP_WINDOW);
  }

  /** Hard step cap, if configured. */
  get maxSteps(): number | undefined {
    return this.rails.maxSteps;
  }

  /** Should the run stop *before* running turn `stepIndex`? (step cap) */
  stepBreach(stepIndex: number): GuardrailBreach | null {
    if (this.rails.maxSteps !== undefined && stepIndex >= this.rails.maxSteps) {
      return { type: 'max_steps', limit: this.rails.maxSteps, observed: stepIndex };
    }
    return null;
  }

  /** Accumulate a completed model turn's usage + estimated cost. */
  recordCompletion(completion: LlmCompletion): void {
    this.tokens += totalTokens(completion.usage);
    if (getPricing(completion.model)) {
      this.costUsd += estimateCostUsd(completion.model, completion.usage);
    }
  }

  /** Should the run stop after the latest turn? (token / cost ceilings) */
  budgetBreach(): GuardrailBreach | null {
    if (this.rails.maxTokens !== undefined && this.tokens > this.rails.maxTokens) {
      return { type: 'token_budget', limit: this.rails.maxTokens, observed: this.tokens };
    }
    if (this.rails.maxCostUsd !== undefined && this.costUsd > this.rails.maxCostUsd) {
      return { type: 'cost_budget', limit: this.rails.maxCostUsd, observed: this.costUsd };
    }
    return null;
  }

  /** Record the latest step's tool calls and report a loop if they keep repeating. */
  loopBreach(calls: ToolCall[]): GuardrailBreach | null {
    if (this.loopWindow === null || calls.length === 0) {
      this.lastSignature = null;
      this.repeats = 0;
      return null;
    }
    const sig = signatureOf(calls);
    if (sig === this.lastSignature) {
      this.repeats += 1;
    } else {
      this.lastSignature = sig;
      this.repeats = 1;
    }
    if (this.repeats >= this.loopWindow) {
      return { type: 'loop_detected', signature: sig, repeats: this.repeats };
    }
    return null;
  }
}
