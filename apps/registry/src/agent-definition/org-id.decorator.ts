import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ORG_HEADER = 'x-org-id';

/**
 * Extracts the tenant org id from the `x-org-id` request header, normalizing a
 * blank/absent value to `null` (the shared namespace).
 *
 * Implemented as a custom param decorator rather than `@Headers('x-org-id')`
 * so Swagger does not auto-generate an (incorrectly required, undocumented)
 * header parameter — the controller documents it once via `@ApiHeader`.
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const raw = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers[
      ORG_HEADER
    ];
    const value = (Array.isArray(raw) ? raw[0] : raw ?? '').toString().trim();
    return value.length > 0 ? value : null;
  },
);
