import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthPrincipal } from '@helix/auth';

/**
 * Inject the authenticated {@link AuthPrincipal} a guard put on the request
 * (HELIX-142). Use on routes behind {@link AuthGuard}; undefined otherwise.
 */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined =>
    ctx.switchToHttp().getRequest<{ principal?: AuthPrincipal }>().principal,
);
