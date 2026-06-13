import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthPrincipal, SessionService } from '@helix/auth';
import { SESSION_SERVICE } from './auth.tokens';

/** The request shape we read/augment — avoids a hard dependency on express types. */
interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: AuthPrincipal;
}

/**
 * Requires a valid Helix session (HELIX-142): reads `Authorization: Bearer <token>`,
 * verifies it via the {@link SessionService}, and attaches the {@link AuthPrincipal}
 * to the request (read it with `@Principal()`). 401 on missing/invalid/expired.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SESSION_SERVICE) private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      req.principal = this.sessions.verify(value.slice('Bearer '.length));
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired session');
    }
  }
}
