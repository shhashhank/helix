import { Body, Controller, ForbiddenException, Get, Inject, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ADMIN,
  type AuthPrincipal,
  type OidcVerifier,
  OidcError,
  type SessionService,
  authenticateWithIdToken,
  signJwt,
} from '@helix/auth';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Principal } from './principal.decorator';
import { CreateSessionDto, DevLoginDto, SessionResponseDto, AuthPrincipalDto } from './dto/auth.dto';
import { OIDC_CONFIG, type OidcConfig, OIDC_VERIFIER, SESSION_SERVICE } from './auth.tokens';

/** Dev sign-in is available outside production, or when explicitly opted in. */
function devLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.AUTH_DEV_LOGIN === 'true';
}

/** Sign-in + session endpoints (HELIX-142). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(OIDC_VERIFIER) private readonly verifier: OidcVerifier,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(OIDC_CONFIG) private readonly oidc: OidcConfig,
  ) {}

  @Post('session')
  @ApiOperation({ summary: 'Exchange an OIDC ID token for a Helix session' })
  @ApiCreatedResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'The ID token failed OIDC verification' })
  async createSession(@Body() body: CreateSessionDto): Promise<SessionResponseDto> {
    try {
      const { session, principal } = await authenticateWithIdToken(this.verifier, this.sessions, body.idToken);
      return { token: session.token, expiresAt: session.expiresAt, principal };
    } catch (err) {
      if (err instanceof OidcError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }

  @Post('dev-login')
  @ApiOperation({
    summary: 'Dev-only sign-in: mint + exchange a session for an email/org/roles (no real IdP needed)',
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  @ApiForbiddenResponse({ description: 'Dev login is disabled (production)' })
  async devLogin(@Body() body: DevLoginDto): Promise<SessionResponseDto> {
    if (!devLoginEnabled()) {
      throw new ForbiddenException('dev login is disabled');
    }
    const roles = body.roles?.length ? body.roles : [ADMIN];
    // Mint a stand-in OIDC ID token the configured verifier will accept, then exchange it
    // — the same path a real IdP token takes, so nothing downstream is special-cased.
    const idToken = signJwt(
      { iss: this.oidc.issuer, aud: this.oidc.audience, sub: body.email, email: body.email, org: body.org, roles },
      this.oidc.secret,
      { expiresInSeconds: 600 },
    );
    const { session, principal } = await authenticateWithIdToken(this.verifier, this.sessions, idToken);
    return { token: session.token, expiresAt: session.expiresAt, principal };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated principal for the current session' })
  @ApiOkResponse({ type: AuthPrincipalDto })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired session' })
  me(@Principal() principal: AuthPrincipal): AuthPrincipal {
    return principal;
  }

  @Get('admin/ping')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin-only endpoint — demonstrates RBAC enforcement (HELIX-144)' })
  @ApiOkResponse({ description: 'Caller holds the admin role (or higher)' })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired session' })
  @ApiForbiddenResponse({ description: 'Authenticated but lacking the admin role' })
  adminPing(@Principal() principal: AuthPrincipal): { ok: true; principal: AuthPrincipal } {
    return { ok: true, principal };
  }
}
