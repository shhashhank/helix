import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { AuthPrincipal } from '@helix/auth';
import { AuthGuard } from '../auth/auth.guard';
import { Principal } from '../auth/principal.decorator';
import { GithubConnection, GithubConnectionStatus } from './github.model';
import { GithubIntegrationService } from './github-integration.service';
import { CompleteConnectDto, ConnectGithubResponseDto, GithubConnectionDto, GithubConnectionStatusDto } from './dto/github.dto';

/**
 * GitHub onboarding (HELIX-148): the org-scoped, auth-guarded connect flow. The
 * rendered wizard is deferred — these are the endpoints it drives.
 */
@ApiTags('integrations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired session' })
@UseGuards(AuthGuard)
@Controller('integrations/github')
export class GithubIntegrationController {
  constructor(private readonly service: GithubIntegrationService) {}

  @Post('connect')
  @ApiOperation({ summary: 'Start connecting GitHub — returns the App install URL' })
  @ApiCreatedResponse({ type: ConnectGithubResponseDto })
  connect(@Principal() principal: AuthPrincipal): { installUrl: string; state: string } {
    return this.service.beginConnect(principal);
  }

  @Post('callback')
  @ApiOperation({ summary: 'Complete the connect after the GitHub install redirect' })
  @ApiCreatedResponse({ type: GithubConnectionDto })
  callback(@Body() body: CompleteConnectDto, @Principal() principal: AuthPrincipal): Promise<GithubConnection> {
    return this.service.completeConnect(principal, body);
  }

  @Get()
  @ApiOperation({ summary: "The caller org's GitHub connection status" })
  @ApiOkResponse({ type: GithubConnectionStatusDto })
  status(@Principal() principal: AuthPrincipal): Promise<GithubConnectionStatus> {
    return this.service.status(principal);
  }

  @Delete()
  @ApiOperation({ summary: "Disconnect GitHub (delete the org's stored credential)" })
  @ApiOkResponse({ schema: { properties: { disconnected: { type: 'boolean' } } } })
  disconnect(@Principal() principal: AuthPrincipal): Promise<{ disconnected: boolean }> {
    return this.service.disconnect(principal);
  }
}
