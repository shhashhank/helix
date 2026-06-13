import { ADMIN, authorize, AuthorizationError, MEMBER, OWNER, satisfiesAnyRole, satisfiesRole, VIEWER } from '../rbac';

describe('satisfiesRole (ranked built-ins)', () => {
  it('matches the exact role', () => {
    expect(satisfiesRole([MEMBER], MEMBER)).toBe(true);
  });

  it('lets a higher role satisfy a lower requirement', () => {
    expect(satisfiesRole([ADMIN], MEMBER)).toBe(true);
    expect(satisfiesRole([OWNER], VIEWER)).toBe(true);
  });

  it('does not let a lower role satisfy a higher requirement', () => {
    expect(satisfiesRole([MEMBER], ADMIN)).toBe(false);
    expect(satisfiesRole([VIEWER], OWNER)).toBe(false);
  });

  it('matches a custom (unranked) role only exactly', () => {
    expect(satisfiesRole(['billing'], 'billing')).toBe(true);
    expect(satisfiesRole([OWNER], 'billing')).toBe(false); // rank does not imply custom roles
    expect(satisfiesRole(['billing'], ADMIN)).toBe(false);
  });

  it('handles an empty role set', () => {
    expect(satisfiesRole([], MEMBER)).toBe(false);
  });
});

describe('satisfiesAnyRole', () => {
  it('passes when any required role is satisfied', () => {
    expect(satisfiesAnyRole([MEMBER], [ADMIN, MEMBER])).toBe(true);
    expect(satisfiesAnyRole([ADMIN], [OWNER, 'billing'])).toBe(false);
  });

  it('treats an empty requirement as no requirement (allowed)', () => {
    expect(satisfiesAnyRole([], [])).toBe(true);
  });
});

describe('authorize', () => {
  it('passes silently when satisfied and throws AuthorizationError otherwise', () => {
    expect(() => authorize([ADMIN], [MEMBER])).not.toThrow();
    expect(() => authorize([VIEWER], [ADMIN])).toThrow(AuthorizationError);
    expect(() => authorize([VIEWER], [ADMIN])).toThrow(/requires one of: admin/);
  });
});
