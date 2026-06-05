import {
  DEFAULT_RESOURCE_LIMITS,
  defaultSandboxPolicy,
  enforceWallClock,
  evaluateEgress,
  EgressPolicy,
  isHostAllowed,
  resolveSandboxPolicy,
  SandboxPolicyError,
  SandboxTimeoutError,
} from '../policy';

describe('resolveSandboxPolicy', () => {
  it('returns the secure defaults when given nothing', () => {
    const p = resolveSandboxPolicy();
    expect(p.resources).toEqual(DEFAULT_RESOURCE_LIMITS);
    expect(p.egress.defaultAction).toBe('deny');
    expect(p.egress.allow).toContain('registry.npmjs.org');
  });

  it('merges partial overrides over the defaults', () => {
    const p = resolveSandboxPolicy({
      resources: { memoryMb: 512 },
      egress: { allow: ['internal.acme.dev'] },
    });
    expect(p.resources.memoryMb).toBe(512);
    expect(p.resources.cpus).toBe(DEFAULT_RESOURCE_LIMITS.cpus); // untouched default
    expect(p.egress.allow).toEqual(['internal.acme.dev']);
  });

  it('rejects non-positive limits and a non-integer process cap', () => {
    expect(() => resolveSandboxPolicy({ resources: { memoryMb: 0 } })).toThrow(SandboxPolicyError);
    expect(() => resolveSandboxPolicy({ resources: { wallClockMs: -1 } })).toThrow(SandboxPolicyError);
    expect(() => resolveSandboxPolicy({ resources: { maxProcesses: 2.5 } })).toThrow(/integer/);
  });

  it('rejects an empty host in a rule list', () => {
    expect(() => resolveSandboxPolicy({ egress: { allow: ['ok.com', '  '] } })).toThrow(
      SandboxPolicyError,
    );
  });

  it('defaultSandboxPolicy returns an independent copy', () => {
    const a = defaultSandboxPolicy();
    a.egress.allow.push('mutated.example');
    expect(defaultSandboxPolicy().egress.allow).not.toContain('mutated.example');
  });
});

describe('evaluateEgress / isHostAllowed', () => {
  const egress: EgressPolicy = {
    defaultAction: 'deny',
    allow: ['api.github.com', '*.npmjs.org'],
    deny: ['evil.npmjs.org'],
  };

  it('allows exact and wildcard-suffix matches (incl. apex)', () => {
    expect(isHostAllowed(egress, 'api.github.com')).toBe(true);
    expect(isHostAllowed(egress, 'registry.npmjs.org')).toBe(true);
    expect(isHostAllowed(egress, 'npmjs.org')).toBe(true); // apex matches *.npmjs.org
  });

  it('denies hosts that match no allow rule (default-deny)', () => {
    expect(isHostAllowed(egress, 'example.com')).toBe(false);
    expect(isHostAllowed(egress, 'github.com')).toBe(false); // only api.github.com allowed
  });

  it('deny rules win over allow rules', () => {
    expect(evaluateEgress(egress, 'evil.npmjs.org')).toBe('deny');
  });

  it('is case-insensitive', () => {
    expect(isHostAllowed(egress, 'API.GitHub.com')).toBe(true);
  });
});

describe('enforceWallClock', () => {
  it('resolves with the operation when it finishes in time', async () => {
    await expect(enforceWallClock(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with SandboxTimeoutError when the limit is exceeded', async () => {
    jest.useFakeTimers();
    try {
      const raced = enforceWallClock(new Promise<never>(() => undefined), 5000);
      const assertion = expect(raced).rejects.toBeInstanceOf(SandboxTimeoutError);
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
