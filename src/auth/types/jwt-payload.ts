import type { UserRole } from '@prisma/client';

export interface JwtPayloadBase {
  sub: string; // user id
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AccessTokenPayload extends JwtPayloadBase {
  type: 'access';
}

export interface RefreshTokenPayload extends JwtPayloadBase {
  type: 'refresh';
}
