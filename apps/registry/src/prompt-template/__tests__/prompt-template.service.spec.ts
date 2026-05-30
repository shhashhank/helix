import { PromptTemplateError } from '../prompt-template.error';
import { PromptTemplateService, SystemPromptSpec } from '../prompt-template.service';

const spec = (overrides: Partial<SystemPromptSpec> = {}): SystemPromptSpec => ({
  template: 'Hello {{name}}',
  ...overrides,
});

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;

  beforeEach(() => {
    service = new PromptTemplateService();
  });

  describe('interpolation', () => {
    it('substitutes a declared variable from context', () => {
      const out = service.render(
        spec({ variables: [{ name: 'name', type: 'string' }] }),
        { name: 'Ada' },
      );
      expect(out).toBe('Hello Ada');
    });

    it('does not HTML-escape values (prompts are plain text)', () => {
      const out = service.render(spec({ template: '{{q}}' }), { q: `"a" < b & c` });
      expect(out).toBe(`"a" < b & c`);
    });

    it('renders sections/loops over array context', () => {
      const out = service.render(
        spec({ template: '{{#each items}}{{this}},{{/each}}' }),
        { items: ['a', 'b'] },
      );
      expect(out).toBe('a,b,');
    });

    it('passes undeclared context keys through (context injection)', () => {
      const out = service.render(
        spec({ template: '{{name}} on {{today}}', variables: [{ name: 'name', type: 'string' }] }),
        { name: 'Ada', today: '2026-05-30' },
      );
      expect(out).toBe('Ada on 2026-05-30');
    });
  });

  describe('variable validation', () => {
    it('throws when a required variable is missing (required defaults true)', () => {
      expect(() =>
        service.render(spec({ variables: [{ name: 'name', type: 'string' }] }), {}),
      ).toThrow(PromptTemplateError);
    });

    it('applies a default when an absent variable declares one', () => {
      const out = service.render(
        spec({ variables: [{ name: 'name', type: 'string', default: 'World' }] }),
        {},
      );
      expect(out).toBe('Hello World');
    });

    it('allows an optional variable to be absent (renders empty)', () => {
      const out = service.render(
        spec({ variables: [{ name: 'name', type: 'string', required: false }] }),
        {},
      );
      expect(out).toBe('Hello ');
    });

    it('rejects a value whose type does not match the declaration', () => {
      expect(() =>
        service.render(spec({ variables: [{ name: 'name', type: 'number' }] }), { name: 'nope' }),
      ).toThrow(/expected type number/);
    });

    it('distinguishes array from object in type checks', () => {
      expect(() =>
        service.render(spec({ template: '{{x}}', variables: [{ name: 'x', type: 'object' }] }), {
          x: [1, 2],
        }),
      ).toThrow(/expected type object but got array/);
    });

    it('attaches the offending variable name to the error', () => {
      try {
        service.render(spec({ variables: [{ name: 'name', type: 'string' }] }), {});
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PromptTemplateError);
        expect((err as PromptTemplateError).variable).toBe('name');
      }
    });
  });

  describe('engines', () => {
    it('defaults to mustache-compatible rendering when engine is unspecified', () => {
      const out = service.render(
        spec({ template: '{{greeting}}', variables: [{ name: 'greeting', type: 'string' }] }),
        { greeting: 'hi' },
      );
      expect(out).toBe('hi');
    });

    it('renders explicit handlebars block helpers', () => {
      const out = service.render(
        spec({
          templateEngine: 'handlebars',
          template: '{{#if on}}yes{{else}}no{{/if}}',
          variables: [{ name: 'on', type: 'boolean' }],
        }),
        { on: true },
      );
      expect(out).toBe('yes');
    });

    it('returns the template verbatim for the plain engine (no interpolation)', () => {
      const out = service.render(
        spec({ templateEngine: 'plain', template: 'Hello {{name}}' }),
        { name: 'Ada' },
      );
      expect(out).toBe('Hello {{name}}');
    });
  });

  describe('partials', () => {
    it('renders a registered partial', () => {
      const out = service.render(
        spec({ template: 'A: {{> sig}}', variables: [{ name: 'who', type: 'string' }] }),
        { who: 'Helix' },
        { partials: { sig: '-- {{who}}' } },
      );
      expect(out).toBe('A: -- Helix');
    });

    it('isolates partials per render (no leakage across calls)', () => {
      service.render(spec({ template: '{{> sig}}' }), {}, { partials: { sig: 'x' } });
      expect(() => service.render(spec({ template: '{{> sig}}' }), {})).toThrow(PromptTemplateError);
    });
  });

  describe('compile errors', () => {
    it('wraps malformed template syntax in a PromptTemplateError', () => {
      expect(() => service.render(spec({ template: '{{#each}}{{/if}}' }), {})).toThrow(
        PromptTemplateError,
      );
    });
  });
});
