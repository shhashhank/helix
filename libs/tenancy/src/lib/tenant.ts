/**
 * Row-level tenant isolation (HELIX-143). Every tenant-owned row carries an
 * `orgId`; a request acts within a {@link TenantScope}, and these helpers make sure
 * a query can only ever touch rows in that scope. Pure and storage-agnostic — the
 * registry threads a scope through its data layer, and the same primitives serve
 * any other org-scoped resource (runs, approval policies, …).
 *
 * The scope's source is itself a seam: today it comes from the `x-org-id` header,
 * and it can come from the authenticated principal's `orgId` (HELIX-142) without
 * touching any of this.
 */

/** An org/tenant id. `null` is the shared/global namespace (the registry convention). */
export type OrgId = string | null;

/** Whose rows a request may read or write. */
export interface TenantScope {
  orgId: OrgId;
}

/** Build a {@link TenantScope} from an org id (header, auth principal, …). */
export function tenantScope(orgId: OrgId): TenantScope {
  return { orgId };
}

/** Raised on a cross-tenant access attempt. */
export class TenantIsolationError extends Error {
  constructor(message = 'cross-tenant access denied') {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

/** Whether a resource's org matches the scope (`null` matches `null` — same shared tenant). */
export function belongsToTenant(scope: TenantScope, resourceOrgId: OrgId): boolean {
  return resourceOrgId === scope.orgId;
}

/** Throw {@link TenantIsolationError} unless the resource belongs to the scope's tenant. */
export function assertTenant(scope: TenantScope, resourceOrgId: OrgId): void {
  if (!belongsToTenant(scope, resourceOrgId)) throw new TenantIsolationError();
}

/**
 * Add the scope's `orgId` to a query's where-clause for row-level scoping, so it can
 * only ever match the caller's rows. The scope is **authoritative** — it overrides
 * any `orgId` already present, and other conditions are preserved.
 */
export function scopedWhere<W extends object>(scope: TenantScope, where?: W): W & { orgId: OrgId } {
  return { ...(where ?? ({} as W)), orgId: scope.orgId };
}
