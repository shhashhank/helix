import { SetMetadata } from '@nestjs/common';

/** Metadata key holding a route's required roles. */
export const ROLES_KEY = 'helix:roles';

/**
 * Gate a route to callers holding (at least) one of the given roles (HELIX-144).
 * Use with `@UseGuards(AuthGuard, RolesGuard)` — `AuthGuard` establishes the
 * principal, `RolesGuard` checks it against these roles. Built-in roles are ranked,
 * so `@Roles('member')` also admits `admin` / `owner`.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
