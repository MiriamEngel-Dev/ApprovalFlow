# ADR-005: Monorepo with shared library

**Status:** Accepted
**Date:** 2026-07-04

**Context:** The four services all need the same set of types (`Invoice`, `AgentAssessment`,
`Decision`, `SagaState`, `Route`), plus a Dapr HTTP client wrapper, correlation-id propagation, and
the same structured-logging setup. Copy-pasting that across four separate repos is exactly how
they'd quietly drift apart from each other.

**Decision:** One monorepo. `services/{submission,decision,payment,audit}-service/` are the
independently deployable units, and `shared/` is an internal package holding `types.ts`,
`dapr-client.ts`, `correlation-id.ts`, and `pino-config.ts`, resolved across the workspace via npm
workspaces.

Each service still keeps its own `package.json`, `Dockerfile`, `tsconfig.json`, and Drizzle schema.
The shared package has zero dependencies on any individual service, and there's no shared database
object anywhere.

**Consequences:** There's a single source of truth for API contracts and Dapr interaction
patterns, and CI catches any cross-service breakage on every push since TypeScript compilation
checks every consumer of the shared package. The tradeoff is that a change to `shared/` touches
every service at once, so it has to stay backward-compatible, and npm workspaces add a little
tooling overhead compared to plain relative imports — worth it here for how much cleaner the
result is.
