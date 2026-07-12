import type { FastifyInstance } from 'fastify';
import { sql } from '../db/client.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/health/ready', async (_request, reply) => {
    const checks = { db: false, dapr: false };

    try {
      await sql`select 1`;
      checks.db = true;
    } catch {
      checks.db = false;
    }

    try {
      const daprHttpPort = process.env.DAPR_HTTP_PORT ?? '3500';
      const res = await fetch(`http://localhost:${daprHttpPort}/v1.0/healthz`);
      checks.dapr = res.ok;
    } catch {
      checks.dapr = false;
    }

    const ready = Object.values(checks).every(Boolean);
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
}
