import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthPrincipal, satisfiesAnyRole } from '@helix/auth';
import { ROLES_KEY } from './roles.decorator';

interface AuthedRequest {
  principal?: AuthPrincipal;
}

/**
 * Enforces a route's `@Roles(...)` requirement against the authenticated principal
 * (HELIX-144). Runs after {@link AuthGuard} (which sets `req.principal`): no
 * requirement → allow; a principal lacking a sufficient role → 403; no principal at
 * all on a gated route → 401 (AuthGuard wasn't applied).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;

    const principal = context.switchToHttp().getRequest<AuthedRequest>().principal;
    if (!principal) throw new UnauthorizedException('authentication required');
    if (!satisfiesAnyRole(principal.roles, required)) {
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
