import type { FastifyInstance } from 'fastify';
import { mintToken, ROLES, type Role } from '@approvalflow/shared';

interface LoginBody {
  name?: string;
  role?: string;
}

/** N1: this project has no real user accounts (self-signed role tokens only, "no external
 * identity provider needed") — the UI's login screen is just a name + role picker, and this
 * endpoint mints a token for whatever was picked. Deliberately unauthenticated (its whole purpose
 * is issuing a token before the caller has one) and not part of the public API/docs/openapi.yaml
 * role table, since it doesn't require any role itself. */
export function registerAuthRoutes(app: FastifyInstance, signingKey: string): void {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { name, role } = request.body ?? {};
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!role || !ROLES.includes(role as Role)) {
      return reply.status(400).send({ error: `role must be one of: ${ROLES.join(', ')}` });
    }

    const token = mintToken(name.trim(), role as Role, signingKey);
    return reply.send({ token });
  });
}
