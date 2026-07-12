# ADR-004: PostgreSQL for Saga State vs Redis

**Status:** Accepted
**Date:** 2026-07-05

## Context

The payment saga needs somewhere to persist its state — reservations, payments, budget rows. Redis
was already in use as the Dapr state store for idempotency keys and the processed-event cache, so
it was the obvious first option: fast, simple key-value access, no new infrastructure. PostgreSQL
was the other option, offering real transactions, row-level locking, and CHECK/UNIQUE constraints
that Redis doesn't have.

## Decision

PostgreSQL is the primary store for saga state. Redis is kept for things that are genuinely
transient or supplementary.

PostgreSQL holds `department_budgets` (row-locked during reservation), `reservations` (the saga's
own step state — active, confirmed, released, compensated), and `payments` (completed payments,
each with a unique idempotency key). Redis, via the Dapr state store, holds idempotency keys with a
24-hour TTL for fast duplicate checks, a processed-event cache with a 1-hour TTL for deduping
redelivered messages, short-lived ETag-based budget locks (60 seconds) as a fast pre-check before
anything hits PostgreSQL, and the full policy document cache with no expiry.

## Consequences

`SELECT ... FOR UPDATE` gives real row-level locking for concurrency safety — Redis's
WATCH/MULTI/EXEC is optimistic locking, and the retry logic to make that reliable here would have
been more complex and more fragile than just using a database that supports pessimistic locks
natively. CHECK constraints enforce invariants at the database level, so `reserved + spent <=
total` holds even if an application bug tries to violate it. UNIQUE constraints do the same for
duplicates — one payment per idempotency key, one reservation per submission, no amount of
application-level carelessness can get around that. Reservation inserts and budget updates happen
in a single transaction, so a crash mid-write rolls back cleanly instead of leaving partial state.
And the whole saga timeline for any submission is just `SELECT * FROM reservations WHERE
submission_id = $1` — Redis state, by contrast, is deliberately transient and wouldn't support
that kind of reconstruction.

The cost is a small latency hit compared to Redis for simple reads — 1-2ms instead of under 1ms,
which doesn't matter at the volumes this system handles. PostgreSQL is also a single point of
failure inside Docker Compose; `restart: unless-stopped` plus health checks cover that for local
development, and a production deployment would use a managed, replicated PostgreSQL instance
instead.

Redis alone was considered and rejected — no transactions, no row-locking, no CHECK constraints,
which would have pushed all of that correctness burden into application code, and application-
level locking is exactly the kind of thing that's easy to get subtly wrong. Using Dapr's state
store backed by PostgreSQL was also considered, but Dapr's state store is a key-value abstraction
regardless of what's behind it — using it would still mean giving up CHECK constraints, foreign
keys, and row-locking, since those aren't things the abstraction exposes.
