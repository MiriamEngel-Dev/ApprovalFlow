import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AuthError, verifyToken } from './auth.js';

const SECRET = 'test-signing-key';

function bearer(token: string): string {
  return `Bearer ${token}`;
}

describe('verifyToken — algorithm pinning', () => {
  it('accepts a validly-signed HS256 token', () => {
    const token = jwt.sign({ sub: 'user-1', role: 'submitter' }, SECRET, { algorithm: 'HS256' });
    const claims = verifyToken(bearer(token), SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('submitter');
  });

  it('rejects a token signed with alg "none" (unsigned) even if jsonwebtoken would otherwise accept it', () => {
    // Manually construct a { alg: "none" } token — jwt.sign refuses to produce one without an
    // explicit opt-in, so this simulates what an attacker would hand-craft.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'admin' })).toString(
      'base64url',
    );
    const noneToken = `${header}.${payload}.`;

    expect(() => verifyToken(bearer(noneToken), SECRET)).toThrow(AuthError);
  });

  it('rejects a token signed with a different algorithm than the pinned one', () => {
    const token = jwt.sign({ sub: 'user-1', role: 'submitter' }, SECRET, { algorithm: 'HS384' });
    expect(() => verifyToken(bearer(token), SECRET)).toThrow(AuthError);
  });

  it('rejects a missing Authorization header', () => {
    expect(() => verifyToken(undefined, SECRET)).toThrow(AuthError);
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign({ sub: 'user-1', role: 'submitter' }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    expect(() => verifyToken(bearer(token), SECRET)).toThrow(AuthError);
  });
});
