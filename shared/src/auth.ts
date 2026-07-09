import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from './types.js';

export interface AuthClaims {
  sub: string;
  role: Role;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function extractBearerToken(header: string | undefined): string {
  if (!header?.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header', 401);
  }
  return header.slice('Bearer '.length);
}

export function verifyToken(header: string | undefined, signingKey: string): AuthClaims {
  const token = extractBearerToken(header);
  try {
    // Pin the algorithm — without this, jwt.verify accepts whatever algorithm the token itself
    // declares, which is the classic setup for an algorithm-confusion attack if `signingKey` is
    // ever used as an asymmetric public key elsewhere. This project's JWTs are self-signed HS256
    // (a single shared secret, per README/N1), so there's exactly one valid algorithm.
    const payload = jwt.verify(token, signingKey, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      throw new AuthError('Token missing sub/role claims', 401);
    }
    return { sub: payload.sub, role: payload.role as Role };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired token', 401);
  }
}

/** Fastify preHandler factory: 401 on missing/invalid token, 403 on the wrong role. */
export function requireRole(signingKey: string, ...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const claims = verifyToken(request.headers.authorization, signingKey);
      if (!roles.includes(claims.role)) {
        throw new AuthError(`Requires role: ${roles.join(' or ')}`, 403);
      }
      (request as FastifyRequest & { authClaims: AuthClaims }).authClaims = claims;
    } catch (err) {
      if (err instanceof AuthError) {
        await reply.status(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    }
  };
}
