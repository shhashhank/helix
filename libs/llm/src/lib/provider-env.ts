import { AnthropicProvider } from './anthropic.provider';
import { MeteredProvider, type UsageSink } from './metering';
import { ResilientProvider } from './resilience';
import { type ScriptedCompletion, ScriptedLlmProvider } from './scripted.provider';
import type { LlmProvider } from './types';

export interface ProviderFromEnvOptions {
  /** When given, the live provider is wrapped to meter usage to this sink. */
  sink?: UsageSink;
  /** The canned completion the scripted provider returns when no API key is set. */
  scripted?: ScriptedCompletion;
}

export interface ProviderSelection {
  provider: LlmProvider;
  /** `anthropic` when an API key was configured, else the offline `scripted` stand-in. */
  mode: 'anthropic' | 'scripted';
}

/**
 * Pick the LLM provider from the environment (HELIX-158) — the config-driven seam the
 * worker uses. With `ANTHROPIC_API_KEY` set, the real {@link AnthropicProvider} wrapped
 * for resilience (retry/backoff/timeout/breaker) and, if a `sink` is given, metering;
 * otherwise the offline {@link ScriptedLlmProvider} so a run still executes end-to-end.
 * The key is read from the environment only — never logged or persisted here.
 */
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderFromEnvOptions = {},
): ProviderSelection {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    let provider: LlmProvider = new ResilientProvider([new AnthropicProvider({ apiKey })]);
    if (options.sink) provider = new MeteredProvider(provider, options.sink);
    return { provider, mode: 'anthropic' };
  }
  return { provider: new ScriptedLlmProvider(options.scripted), mode: 'scripted' };
}
