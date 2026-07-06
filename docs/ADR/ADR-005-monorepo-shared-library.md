# ADR-005: Monorepo with shared library

**Context:** Four microservices need shared types (Invoice, AgentAssessment, Decision,
SagaState, Route), a Dapr HTTP client wrapper, correlation-ID propagation, and a
structured-logging configuration. Copy-pasting these across services creates drift.

**Decision:** Single monorepo with:
- `services/{submission,decision,payment,audit}-service/` — independent deployable units
- `shared/` — internal package with `types.ts`, `dapr-client.ts`, `correlation-id.ts`,
  `pino-config.ts`
- npm workspaces (or TypeScript project references) to resolve `@approvalflow/shared`

Each service has its own `package.json`, `Dockerfile`, `tsconfig.json`, and Drizzle schema.
Shared code has zero dependencies on any service. No shared database objects.

**Consequences:**
- ✅ Single source of truth for API contracts (types) and Dapr interaction patterns
- ✅ CI catches breakage across services on every push (TypeScript compilation verifies
  all consumers)
- ⚠️ Shared package changes affect all services — must be backward-compatible
- ⚠️ npm workspaces add tooling complexity vs. relative imports (chosen for cleanliness)
