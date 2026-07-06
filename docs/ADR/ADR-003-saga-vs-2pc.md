# ADR-003: Saga Pattern vs Two-Phase Commit (2PC)

**Status:** Accepted
**Date:** 2026-07-05

## Context

The payment flow requires budget consistency:
- Budget must never be overspent (concurrency safety).
- Payment must be idempotent (no double charge).
- On failure, the reservation must be released (no orphaned funds).

Two approaches:

1. **Two-Phase Commit (2PC)** — PostgreSQL's `PREPARE TRANSACTION` across databases.
   Strong consistency, but impossible with an external payment provider.

2. **Saga** — Split into steps, each with a defined compensation action. If a step
   fails, run compensations for previously completed steps. Eventually consistent.

The saga is triggered by the decision-service (on `auto_approve` or `ApprovalCompleted`)
but **owned and executed by payment-service** — the saga steps (budget reserve, payment
execution, confirmation) all operate on payment-service's tables.

## Decision

Use the **Saga pattern** with three steps, each with a defined compensation:

| Step | Forward | Compensation |
|---|---|---|
| 1. Reserve Budget | `SELECT ... FOR UPDATE` on department budget; if `remaining ≥ amount`: UPDATE `reserved += amount`, INSERT `reservation (active)` | UPDATE reservation → `released`, `reserved -= amount` |
| 2. Execute Payment | Call mock payment provider with idempotency key; INSERT `payment (completed)` | If charged: refund. Always: release reservation |
| 3. Confirm | UPDATE reservation → `confirmed`; `reserved -= amount, spent += amount` | `spent -= amount`, release reservation, refund if charged |

**Concurrency:** `SELECT ... FOR UPDATE` row-locks the department budget row. Two
concurrent sagas serialize on this lock. INV-1014A+B ($600 each vs $1,000 budget): Saga A
locks → sees $1,000 → reserves $600 → commits. Saga B unblocks → sees $400 < $600 →
ROLLBACK → FAILED.

**Timeout recovery:** On startup, payment-service scans `reservations WHERE status='active'
AND created_at < NOW() - INTERVAL '60 seconds'`. For each stuck row: query payment
provider by idempotency key → if charged, confirm; if not charged, compensate; if
unreachable, retry 3× with backoff, then leave `active` + alert.

**Idempotency:** The payment step uses `idempotency_key UNIQUE` — the provider is
called with this key, so even if the saga retries the same payment, the provider
deduplicates. Before compensating, query the provider by idempotency key to confirm
the payment was not actually processed.

## Consequences

**Positive:**
- No distributed transaction protocol needed. 2PC across PostgreSQL + external payment
  provider is impossible.
- Concurrency safety via row-locking at the database level.
- Compensation is explicit and auditable.
- Timeout recovery is straightforward — no coordinator failure protocol.
- Fits the microservice boundary: payment-service owns the entire saga.

**Negative:**
- Eventually consistent, not atomic. Between reserve and execute, budget shows reserved
  but not spent (millisecond window — acceptable).
- Compensation must be correct. If compensation itself fails, the startup scan retries
  and alerts fire.

**Alternatives considered:**
- 2PC: Impossible with an external payment provider. Would require cross-service DB
  access — violating service boundaries.
- Outbox-only (no saga): No budget reservation, no compensation. Fails M9.
