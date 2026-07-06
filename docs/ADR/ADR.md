# ADR Index — Architecture Decision Records

Key architectural decisions for ApprovalFlow. Each ADR follows the format:
**Context → Decision → Consequences**. One file per decision.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-autonomy-ceiling.md) | Autonomy Ceiling — $250 Default | Accepted |
| [ADR-002](ADR-002-dapr-service-mesh.md) | Dapr as Service Mesh vs Direct HTTP Calls | Accepted |
| [ADR-003](ADR-003-saga-vs-2pc.md) | Saga Pattern vs Two-Phase Commit (2PC) | Accepted |
| [ADR-004](ADR-004-postgres-saga-state.md) | PostgreSQL for Saga State vs Redis | Accepted |
| [ADR-005](ADR-005-monorepo-shared-library.md) | Monorepo with shared library | Accepted |
| [ADR-006](ADR-006-nodejs-typescript.md) | Node.js / TypeScript over other languages | Accepted |
| [ADR-007](ADR-007-drizzle-orm.md) | Drizzle ORM over Prisma / TypeORM | Accepted |
| [ADR-008](ADR-008-fail-open-llm.md) | Fail-open for AI provider errors | Accepted |
| [ADR-009](ADR-009-database-per-service.md) | Database-per-service over shared database | Accepted |
| [ADR-010](ADR-010-billing-period-field.md) | Structured `billingPeriod` field over inferring from free text | Accepted |
| [ADR-011](ADR-011-decision-service-scope.md) | decision-service scope — considered-and-rejected assessment/workflow split | Accepted |
| [ADR-012](ADR-012-policy-snapshot.md) | Policy snapshot per decision — closing the F9/F10 proof gap | **Draft — needs your own review** |
| [ADR-013](ADR-013-multi-instance-safety.md) | `FOR UPDATE SKIP LOCKED` for background polling loops | **Draft — needs your own review** |
