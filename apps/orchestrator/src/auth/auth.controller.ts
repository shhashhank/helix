import { Body, Controller, Get, Inject, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ADMIN, type AuthPrincipal, type OidcVerifier, OidcError, type SessionService, authenticateWithIdToken } from '@helix/auth';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Principal } from './principal.decorator';
import { CreateSessionDto, SessionResponseDto, AuthPrincipalDto } from './dto/auth.dto';
import { OIDC_VERIFIER, SESSION_SERVICE } from './auth.tokens';

/** Sign-in + session endpoints (HELIX-142). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(OIDC_VERIFIER) private readonly verifier: OidcVerifier,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
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
