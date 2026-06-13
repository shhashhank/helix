/**
 * Role-based access control (HELIX-144). Pure authorization logic over the roles an
 * {@link AuthPrincipal} carries (HELIX-142). The built-in Helix roles are **ranked**
 * — a higher role satisfies a requirement for a lower one (an `owner` passes an
 * `admin`-gated check) — while any unrecognised/custom role is matched exactly.
 *
 * Framework-agnostic on purpose: the orchestrator's `RolesGuard` + `@Roles()`
 * decorator are a thin wrapper around `satisfiesAnyRole`, and the same logic works
 * anywhere a request resolves to a principal.
 */

/** The built-in Helix roles, lowest to highest privilege. */
export const VIEWER = 'viewer';
export const MEMBER = 'member';
export const ADMIN = 'admin';
export const OWNER = 'owner';

/** Privilege rank of the built-in roles; higher satisfies a lower requirement. */
export const ROLE_RANK: Readonly<Record<string, number>> = {
  [VIEWER]: 0,
  [MEMBER]: 1,
  [ADMIN]: 2,
  [OWNER]: 3,
};

/** Raised when a principal lacks the role(s) a route requires (maps to HTTP 403). */
export class AuthorizationError extends Error {
  constructor(message = 'insufficient role') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Whether a set of held roles satisfies a single required role. A held role
 * satisfies it by **exact match**, or — for the built-in ranked roles — by holding
 * a role of **equal or higher** rank.
 */
export function satisfiesRole(held: readonly string[], required: string): boolean {
  if (held.includes(required)) return true;
  const requiredRank = ROLE_RANK[required];
  if (requiredRank === undefined) return false; // custom role → exact match only
  return held.some((r) => ROLE_RANK[r] !== undefined && ROLE_RANK[r] >= requiredRank);
}

/**
 * Whether held roles satisfy **any** of the required roles. An empty requirement is
 * treated as "no role required" (allowed) — callers gate access by *having* a
 * requirement, not by the absence of one.
 */
export function satisfiesAnyRole(held: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return required.some((r) => satisfiesRole(held, r));
}

/** Throw {@link AuthorizationError} unless the held roles satisfy one of the required. */
export function authorize(held: readonly string[], required: readonly string[]): void {
  if (!satisfiesAnyRole(held, required)) {
    throw new AuthorizationError(`requires one of: ${required.join(', ')}`);
  }
}
