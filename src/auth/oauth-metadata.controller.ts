import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from './public.decorator';

const MCP_SCOPES = [
  'collasco:projects:read',
  'collasco:project-structure:read',
  'collasco:project-labels:read',
];

@Public()
@Controller('.well-known')
export class OAuthMetadataController {
  constructor(private readonly config: ConfigService) {}

  @Get('oauth-authorization-server')
  authorizationServerMetadata(@Req() request: Request) {
    const issuer = this.publicIssuer(request);

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/auth/login`,
      revocation_endpoint: `${issuer}/auth/logout`,
      response_types_supported: ['token'],
      grant_types_supported: ['password', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ['header'],
    };
  }

  private publicIssuer(request: Request): string {
    const configured = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (configured) return stripTrailingSlash(configured);

    const protocol = request.protocol;
    const host = request.get('host') ?? `localhost:${this.config.get<number>('PORT') ?? 3000}`;
    return `${protocol}://${host}/v1`;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
