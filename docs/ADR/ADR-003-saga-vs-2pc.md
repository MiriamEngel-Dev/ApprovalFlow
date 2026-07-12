# ADR-003: Saga Pattern vs Two-Phase Commit (2PC)

**Status:** Accepted
**Date:** 2026-07-05

## Context

The payment flow has three hard requirements: budgets can never go over, payments can never
double-charge, and a failure has to release whatever reservation it was holding rather than
leaving money stuck in limbo. The textbook consistency tool here is two-phase commit — but 2PC
needs every participant to speak the protocol, and an external payment provider simply doesn't.
That leaves a saga: break the flow into steps, give each step an explicit compensation, and if a
step fails, run compensations for whatever already succeeded. It's eventually consistent rather
than atomic, but it's the only option that works with a provider outside our control.

The saga gets triggered by decision-service — on `auto_approve` or on `ApprovalCompleted` — but
payment-service owns and runs it end to end; every step operates on payment-service's own tables.

## Decision

Three steps, each with its own compensation. Reserving the budget locks the department's budget
row with `SELECT ... FOR UPDATE`, checks that `remaining >= amount`, and if so increments
`reserved` and inserts an active reservation row; compensating that step flips the reservation to
`released` and backs `reserved` down again. Executing the payment calls the mock provider with an
idempotency key and inserts a completed payment row; if that step needs to unwind, anything
actually charged gets refunded and the reservation is released regardless. Confirming moves the
reservation to `confirmed`, shifts the amount from `reserved` to `spent`; compensating that
reverses the spend, releases the reservation, and refunds if a charge went through.

Concurrency safety comes from the row lock on the department budget during reservation. Two sagas
racing for the same department serialize on that lock rather than racing on the balance itself —
INV-1014A and INV-1014B, $600 each against a $1,000 budget, is the fixture that proves it: saga A
locks the row, sees $1,000 available, reserves $600, and commits; saga B only unblocks after that,
sees $400 remaining against a $600 request, and rolls back to `FAILED`.

For recovery, payment-service scans on startup for reservations still marked `active` after 60
seconds. For each one, it queries the payment provider by idempotency key: if the charge went
through, it confirms; if not, it compensates; if the provider itself is unreachable, it retries
three times with backoff and then leaves the reservation active and raises an alert rather than
guessing.

Idempotency is enforced with a `UNIQUE` constraint on the idempotency key itself — even if the saga
retries the same payment step, the provider (and the constraint) will refuse to double it. Before
compensating anything, the recovery scan always checks with the provider first, so a payment that
actually succeeded never gets refunded by mistake.

## Consequences

None of this needs a distributed transaction protocol, which is good, because 2PC across
PostgreSQL and an external payment provider was never on the table to begin with. Concurrency
safety sits at the database level via row locking rather than in application logic, compensation
is explicit and shows up in the audit trail, and recovering from a timeout doesn't need any kind of
coordinator failure protocol — it's just a scheduled scan. The whole thing also respects the
service boundary cleanly: payment-service owns its saga start to finish.

The tradeoff is that the system isn't atomic — there's a real, if brief, window between reserving
and executing where the budget shows a reservation that hasn't actually turned into a payment yet.
In practice that window is milliseconds and hasn't caused problems. The other risk is that
compensation itself has to be correct; if it isn't, the startup scan will retry it and eventually
alert rather than fail silently.

2PC was ruled out for the reason already stated — no cross-database transaction is possible with
an external provider, and forcing one would mean payment-service reaching into another service's
database, which breaks the boundary the whole system is built around. Skipping the saga entirely
and relying only on the outbox pattern was also considered, but that gives up budget reservation
and compensation altogether, which fails the M9 requirement outright.
