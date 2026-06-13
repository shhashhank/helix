import { ScriptedLlmProvider } from '../scripted.provider';
import { providerFromEnv } from '../provider-env';

describe('ScriptedLlmProvider', () => {
  it('returns a valid, finished completion with default text', async () => {
    const c = await new ScriptedLlmProvider().complete({ messages: [] });
    expect(c.stopReason).toBe('end_turn');
    expect(c.text).toContain('scripted');
    expect(c.content).toEqual([{ type: 'text', text: c.text }]);
    expect(c.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });

  it('echoes scripted overrides', async () => {
    const c = await new ScriptedLlmProvider({ text: 'a plan', model: 'fake-1', stopReason: 'stop_sequence' }).complete({ messages: [] });
    expect(c.text).toBe('a plan');
    expect(c.model).toBe('fake-1');
    expect(c.stopReason).toBe('stop_sequence');
  });
});

describe('providerFromEnv', () => {
  it('uses the scripted provider when no API key is set', () => {
    const sel = providerFromEnv({});
    expect(sel.mode).toBe('scripted');
    expect(sel.provider).toBeInstanceOf(ScriptedLlmProvider);
  });

  it('uses the real (resilient-wrapped) Anthropic provider when ANTHROPIC_API_KEY is set', () => {
    const sel = providerFromEnv({ ANTHROPIC_API_KEY: 'sk-test-not-real' });
    expect(sel.mode).toBe('anthropic');
    expect(sel.provider.name).toBe('resilient'); // ResilientProvider([AnthropicProvider])
  });

  it('treats a blank key as no key', () => {
    expect(providerFromEnv({ ANTHROPIC_API_KEY: '   ' }).mode).toBe('scripted');
  });

  it('passes the scripted fallback text through when offline', async () => {
    const sel = providerFromEnv({}, { scripted: { text: 'offline output' } });
    expect((await sel.provider.complete({ messages: [] })).text).toBe('offline output');
  });
});
