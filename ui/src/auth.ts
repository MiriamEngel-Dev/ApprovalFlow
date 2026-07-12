import type { Role } from '@approvalflow/shared';

const TOKEN_KEY = 'approvalflow.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface DecodedClaims {
  sub: string;
  role: Role;
}

/** Decoded client-side purely for display (name/role in the header bar) — never trust this for
 * anything security-sensitive, the backend is the real enforcer of every route's role check. */
export function decodeToken(token: string): DecodedClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as Partial<DecodedClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.role !== 'string') return null;
    return { sub: claims.sub, role: claims.role };
  } catch {
    return null;
  }
}
