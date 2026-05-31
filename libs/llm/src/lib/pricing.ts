import { LlmUsage } from './types';

/**
 * Per-model token pricing in USD per 1,000,000 tokens (Anthropic list prices).
 * Cache reads bill at ~0.1× input and 5-minute cache writes at ~1.25× input,
 * applied to the model's input rate.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;
const PER_MILLION = 1_000_000;

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

/**
 * Returns pricing for a model id, or `undefined` if it isn't in the table.
 * The Messages API echoes back dated snapshot ids (e.g.
 * `claude-haiku-4-5-20251001`) even when called by alias, so on a miss we strip
 * a trailing `-YYYYMMDD` and retry against the alias-keyed table.
 */
export function getPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model] ?? MODEL_PRICING[model.replace(/-\d{8}$/, '')];
}

/**
 * Estimate the USD cost of a single call from its token usage. Throws if the
 * model has no known pricing (better to fail loudly than under-count spend);
 * pass `pricing` explicitly to price a model that isn't in the table.
 */
export function estimateCostUsd(
  model: string,
  usage: LlmUsage,
  pricing: ModelPricing | undefined = getPricing(model),
): number {
  if (!pricing) {
    throw new Error(`no pricing for model "${model}"; pass pricing explicitly`);
  }
  const inRate = pricing.inputPerMTok / PER_MILLION;
  const outRate = pricing.outputPerMTok / PER_MILLION;
  return (
    usage.inputTokens * inRate +
    usage.outputTokens * outRate +
    usage.cacheReadInputTokens * inRate * CACHE_READ_MULTIPLIER +
    usage.cacheCreationInputTokens * inRate * CACHE_WRITE_MULTIPLIER
  );
}

/** Raised when a call's actual cost exceeds the route's cost ceiling. */
export class CostCeilingExceededError extends Error {
  constructor(
    public readonly model: string,
    public readonly costUsd: number,
    public readonly ceilingUsd: number,
  ) {
    super(
      `call cost $${costUsd.toFixed(4)} for model "${model}" exceeded ceiling $${ceilingUsd.toFixed(4)}`,
    );
    this.name = 'CostCeilingExceededError';
  }
}

/**
 * Throw {@link CostCeilingExceededError} if the call's cost exceeds `ceilingUsd`.
 * A `null`/`undefined` ceiling means "no limit" and is always allowed.
 */
export function assertWithinCeiling(
  model: string,
  usage: LlmUsage,
  ceilingUsd: number | null | undefined,
): number {
  const cost = estimateCostUsd(model, usage);
  if (ceilingUsd != null && cost > ceilingUsd) {
    throw new CostCeilingExceededError(model, cost, ceilingUsd);
  }
  return cost;
}
