# ADR-004: PostgreSQL for Saga State vs Redis

**Status:** Accepted
**Date:** 2026-07-05

## Context

The payment saga needs to persist its state (reservations, payments, budget rows). Two
storage backends are available:

1. **Redis** — Dapr state store. Fast key-value API, already used for idempotency keys
   and processed event cache. Simple to use via Dapr.

2. **PostgreSQL** — Relational database. Supports transactions, row-level locking,
   CHECK constraints, and UNIQUE constraints.

## Decision

Use **PostgreSQL** as the primary saga state store. Redis is used only for transient
and supplementary data.

**PostgreSQL holds:**
- `department_budgets` — row-locked during budget reserve
- `reservations` — saga step state (active/confirmed/released/compensated)
- `payments` — completed payments with unique idempotency keys

**Redis holds (Dapr state store):**
- Idempotency keys (TTL 24h) — fast duplicate detection without DB query
- Processed event cache (TTL 1h) — dedup of redelivered events
- Budget locks (TTL 60s, ETag-based) — supplementary fast-circuit check before
  reaching PostgreSQL
- Policy cache — full policy document, no TTL

## Consequences

**Positive:**
- **`SELECT ... FOR UPDATE`** provides row-level locking for concurrency safety.
  Redis WATCH/MULTI/EXEC is optimistic — retry logic would be complex and fragile.
- **CHECK constraints** enforce invariants at the database level:
  `reserved + spent <= total` prevents overspend even if application logic has a bug.
- **UNIQUE constraints** prevent duplicates: one payment per idempotency key, one
  reservation per submission.
- **Atomic transactions** — reservation insert + budget update in one BEGIN/COMMIT.
  Crash mid-transaction → PostgreSQL rolls back, no partial state.
- **Auditability** — `SELECT * FROM reservations WHERE submission_id = $1` reconstructs
  the full saga timeline. Redis state is transient by design.

**Negative:**
- Slightly higher latency than Redis for simple reads (1-2ms vs <1ms). Not material
  for hundreds of submissions per minute.
- PostgreSQL is a single point of failure in Docker Compose. Mitigated by
  `restart: unless-stopped` and health checks. In production: managed PostgreSQL with
  replication.

**Alternatives considered:**
- Redis-only: No transactions, no row-locking, no CHECK constraints. Application-level
  locking and constraint enforcement would be significantly more complex and error-prone.
- Dapr state store with PostgreSQL backend: Would lose relational guarantees (CHECK,
  FK, row-locking) because Dapr state store is a key-value abstraction, not relational.
