import {
  parseRequirementsSpec,
  REQUIREMENTS_JSON_SCHEMA,
  RequirementsSpec,
  RequirementsValidationError,
} from '../requirements';

const validSpec: RequirementsSpec = {
  title: 'URL shortener',
  summary: 'A service that turns long URLs into short links and redirects them.',
  goals: ['Let users create short links', 'Redirect short links to their target'],
  functionalRequirements: [
    { id: 'FR-1', description: 'Create a short code for a given URL', priority: 'must' },
    { id: 'FR-2', description: 'Redirect a short code to its URL', priority: 'must' },
  ],
  nonFunctionalRequirements: [
    { id: 'NFR-1', description: 'Redirects respond in under 50ms p95', priority: 'should' },
  ],
  constraints: ['Must run on the existing Postgres instance'],
  assumptions: ['Links do not need to expire unless specified'],
  outOfScope: ['Custom vanity domains'],
  openQuestions: ['Should links be private to the creating user?'],
  acceptanceCriteria: ['Creating then visiting a short link reaches the original URL'],
};

describe('parseRequirementsSpec', () => {
  it('accepts a well-formed spec and returns it typed', () => {
    expect(parseRequirementsSpec(structuredClone(validSpec))).toEqual(validSpec);
  });

  it('rejects a non-object', () => {
    expect(() => parseRequirementsSpec('nope')).toThrow(RequirementsValidationError);
  });

  it('reports the path of a missing required field', () => {
    const { title, ...rest } = validSpec;
    void title;
    try {
      parseRequirementsSpec(rest);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RequirementsValidationError);
      expect((err as RequirementsValidationError).issues.join(' ')).toContain('title');
    }
  });

  it('rejects an invalid MoSCoW priority', () => {
    const bad = structuredClone(validSpec);
    (bad.functionalRequirements[0] as { priority: string }).priority = 'urgent';
    expect(() => parseRequirementsSpec(bad)).toThrow(/priority/);
  });

  it('rejects a requirement missing its id', () => {
    const bad = structuredClone(validSpec);
    (bad.functionalRequirements[0] as { id?: string }).id = '';
    expect(() => parseRequirementsSpec(bad)).toThrow(RequirementsValidationError);
  });
});

describe('REQUIREMENTS_JSON_SCHEMA', () => {
  it('is an object schema listing the spec fields as required', () => {
    expect(REQUIREMENTS_JSON_SCHEMA.type).toBe('object');
    expect(REQUIREMENTS_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining(['title', 'functionalRequirements', 'acceptanceCriteria', 'openQuestions']),
    );
  });
});
