import {
  assertTenant,
  belongsToTenant,
  scopedWhere,
  TenantIsolationError,
  tenantScope,
} from '../tenant';

describe('belongsToTenant / assertTenant', () => {
  it('matches same org and the shared (null) namespace', () => {
    expect(belongsToTenant(tenantScope('acme'), 'acme')).toBe(true);
    expect(belongsToTenant(tenantScope(null), null)).toBe(true);
  });

  it('rejects a different org and a null/non-null mismatch', () => {
    expect(belongsToTenant(tenantScope('acme'), 'globex')).toBe(false);
    expect(belongsToTenant(tenantScope('acme'), null)).toBe(false);
    expect(belongsToTenant(tenantScope(null), 'acme')).toBe(false);
  });

  it('assertTenant throws TenantIsolationError only on a mismatch', () => {
    expect(() => assertTenant(tenantScope('acme'), 'acme')).not.toThrow();
    expect(() => assertTenant(tenantScope('acme'), 'globex')).toThrow(TenantIsolationError);
  });
});

describe('scopedWhere', () => {
  it('adds the scope orgId to a where clause, preserving other conditions', () => {
    expect(scopedWhere(tenantScope('acme'), { id: 'x', deletedAt: null })).toEqual({
      id: 'x',
      deletedAt: null,
      orgId: 'acme',
    });
  });

  it('defaults to just the org filter when no where is given', () => {
    expect(scopedWhere(tenantScope('acme'))).toEqual({ orgId: 'acme' });
    expect(scopedWhere(tenantScope(null))).toEqual({ orgId: null });
  });

  it('is authoritative — overrides an orgId already in the where', () => {
    expect(scopedWhere(tenantScope('acme'), { orgId: 'globex', id: 'x' })).toEqual({
      orgId: 'acme',
      id: 'x',
    });
  });
});
