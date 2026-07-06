# ADR-009: Database-per-service over shared database

**Context:** Four services need persistent storage. A shared PostgreSQL database
simplifies queries and transactions but couples services. Dedicated databases per service
provide isolation but add operational complexity.

**Decision:** **Shared PostgreSQL instance, separate databases per service** (logical
isolation, not physical). Each service connects to its own database: `submission_db`,
`decision_db`, `payment_db`, `audit_db`. No cross-database queries or FKs.

**Rationale:**
- Satisfies M3 (microservices) and M4 (single `docker compose up`) simultaneously —
  one PostgreSQL container with 4 databases is operationally simple while logically
  separated
- No cross-service FK constraints — referential integrity enforced at the application
  layer (e.g., `submission_id` in `approval_queue` is validated by decision-service
  fetching from submission-service)
- Each service's schema evolves independently — no migration coordination
- Audit trail is physically separate — auditors can query `audit_db` without impacting
  operational services

**Alternatives considered:**
- Single shared database: Simpler migrations, cross-service JOINs and transactions
  possible. Rejected because it creates tight coupling — a schema change in one service
  can break another, and shared transactions enable accidental cross-service consistency
  that wouldn't survive a service split.
- Separate PostgreSQL containers per service: Maximum isolation. Rejected because 4
  PostgreSQL containers in Docker Compose are heavy, and we're optimizing for dev/test
  experience per M4.

**Consequences:**
- ✅ One PostgreSQL container to manage
- ✅ Logical separation — services cannot accidentally query another's tables
- ✅ Audit database is physically separate for compliance
- ⚠️ Cannot enforce referential integrity across services at DB level (by design)
- ⚠️ Must configure 4 databases in `docker-entrypoint.sh` or init script
