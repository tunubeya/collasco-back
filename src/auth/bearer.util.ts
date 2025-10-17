// src/auth/bearer.util.ts
import { Request } from 'express';

export function getBearerToken(req: Request): string | null {
  const auth = req.get('authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
