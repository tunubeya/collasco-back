// src/auth/strategies/jwt-access.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from '../types/jwt-payload';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(cfg: ConfigService) {
    const secret = cfg.get<string>('JWT_SECRET'); // o cfg.getOrThrow<string>('JWT_SECRET')
    if (!secret) throw new Error('JWT_SECRET is not set');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret, // <- ahora garantizado string
      passReqToCallback: false,
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload | null {
    if (payload?.type !== 'access') return null;
    return payload;
  }
}
