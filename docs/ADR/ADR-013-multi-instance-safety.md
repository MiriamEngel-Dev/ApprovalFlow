# ADR-013: `FOR UPDATE SKIP LOCKED` for background polling loops — multi-instance safety

**Status:** Draft — needs your own review before defending this
**Date:** 2026-07-06

## Context

The evaluation criteria list "scalability" as a graded cross-cutting concern, and the project
brief frames the system as serving "millions of users." Every service is stateless application
logic over PostgreSQL/Redis — but two background polling loops don't react to a single request,
they scan a table on a timer: the outbox relay (every publishing service, §7) and the
stuck-reservation scanner (payment-service, §4). A naive `SELECT ... WHERE ...` poll has no
instance affinity — if a service ever ran as more than one replica, two replicas' scans firing at
the same moment would both select and act on the same rows (duplicate publish, duplicate recovery
attempt).

## Decision

Both loops claim rows with `FOR UPDATE SKIP LOCKED` instead of a plain `SELECT`. Each replica's
scan takes whatever rows it can lock and skips whatever another replica's transaction already
holds, so N replicas partition the work instead of racing on it — with no coordination service,
leader election, or distributed lock required. The shipped `docker-compose.yml` still runs exactly
one replica per service (correct and sufficient for M4's single-machine grading setup); this
decision is about the design not silently breaking if that changes, not about actually running N
replicas today.

## Consequences

**Positive:**
- Safe at any replica count with zero added infrastructure — `SKIP LOCKED` is a standard
  PostgreSQL row-locking clause, not a new moving part.
- No behavior change for the single-replica case shipped today; this is a forward-looking
  correctness fix, not a performance optimization for the grading environment.

**Negative:**
- Doesn't address connection-pool sizing across replicas (§10 notes this separately: N replicas
  means N× the per-instance pool count against PostgreSQL) — a real limit if replica count grows
  large, out of scope for this decision.
- Only covers the two *timer-driven* loops. Ordinary request-handling code paths were already
  safe under multiple replicas by virtue of being stateless; this ADR doesn't change anything
  there.

**Alternatives considered:**
- A dedicated leader-election mechanism (e.g., a Redis-based lock so only one replica ever runs
  the loop): rejected — adds an extra failure mode (what happens if the leader dies mid-batch?)
  and an extra piece of infrastructure to reason about, for a problem `SKIP LOCKED` already solves
  at the database level with no additional moving parts.
- Leaving the loops as plain `SELECT` and relying on downstream dedup (`processed_events`) to mask
  double-publishes: rejected — that hides the problem instead of fixing it, and doesn't help the
  stuck-reservation scanner at all (there's no equivalent downstream dedup for a duplicate
  recovery attempt against the payment provider).
