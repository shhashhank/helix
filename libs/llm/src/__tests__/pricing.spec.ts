import {
  CostCeilingExceededError,
  assertWithinCeiling,
  estimateCostUsd,
  getPricing,
} from '../lib/pricing';
import { LlmUsage } from '../lib/types';

const usage = (overrides: Partial<LlmUsage> = {}): LlmUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  ...overrides,
});

describe('estimateCostUsd', () => {
  it('prices input + output at the model rate', () => {
    // opus: $5/M in, $25/M out → 1M in + 1M out = $30
    expect(estimateCostUsd('claude-opus-4-8', usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }))).toBeCloseTo(30, 6);
  });

  it('prices cache reads at 0.1x and cache writes at 1.25x of input rate', () => {
    // haiku: $1/M in → 1M cache read = $0.10, 1M cache write = $1.25
    expect(estimateCostUsd('claude-haiku-4-5', usage({ cacheReadInputTokens: 1_000_000 }))).toBeCloseTo(0.1, 6);
    expect(estimateCostUsd('claude-haiku-4-5', usage({ cacheCreationInputTokens: 1_000_000 }))).toBeCloseTo(1.25, 6);
  });

  it('throws for an unknown model unless pricing is supplied', () => {
    expect(() => estimateCostUsd('mystery-model', usage({ inputTokens: 100 }))).toThrow(/no pricing/);
    expect(
      estimateCostUsd('mystery-model', usage({ inputTokens: 1_000_000 }), { inputPerMTok: 2, outputPerMTok: 8 }),
    ).toBeCloseTo(2, 6);
  });
});

describe('getPricing', () => {
  it('returns a table entry or undefined', () => {
    expect(getPricing('claude-sonnet-4-6')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
    expect(getPricing('nope')).toBeUndefined();
  });
});

describe('assertWithinCeiling', () => {
  it('returns the cost when under the ceiling', () => {
    const cost = assertWithinCeiling('claude-haiku-4-5', usage({ inputTokens: 1000 }), 1.0);
    expect(cost).toBeGreaterThan(0);
  });

  it('throws CostCeilingExceededError when over', () => {
    expect(() =>
      assertWithinCeiling('claude-opus-4-8', usage({ inputTokens: 1_000_000 }), 1.0),
    ).toThrow(CostCeilingExceededError);
  });

  it('treats null/undefined ceiling as no limit', () => {
    expect(() =>
      assertWithinCeiling('claude-opus-4-8', usage({ inputTokens: 10_000_000 }), null),
    ).not.toThrow();
    expect(() =>
      assertWithinCeiling('claude-opus-4-8', usage({ inputTokens: 10_000_000 }), undefined),
    ).not.toThrow();
  });
});
