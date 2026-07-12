# ADR-013: `FOR UPDATE SKIP LOCKED` for background polling loops — multi-instance safety

**Status:** Accepted
**Date:** 2026-07-06

## Context

Scalability is one of the graded cross-cutting concerns, and the project brief itself frames the
system as serving "millions of users." Every service is stateless application logic sitting over
PostgreSQL/Redis, but two background loops don't just react to individual requests — they scan a
table on a timer instead: the outbox relay running in every publishing service (§7), and the
stuck-reservation scanner in payment-service (§4). A plain `SELECT ... WHERE ...` poll has no
concept of instance affinity, so if either of those services ever ran as more than one replica, two
replicas' scans firing at the same moment would both pick up and act on the same rows — a duplicate
publish, or a duplicate recovery attempt.

## Decision

Both loops now claim rows with `FOR UPDATE SKIP LOCKED` instead of a plain `SELECT`. Each replica's
scan takes whatever rows it can lock and skips whatever another replica's transaction already
holds, so N replicas end up partitioning the work between them instead of racing over it — no
coordination service, no leader election, no distributed lock required anywhere. `docker-
compose.yml` as shipped still runs exactly one replica per service, which is correct and sufficient
for M4's single-machine grading setup; this decision is about the design not silently breaking if
that ever changes, not about actually running multiple replicas today.

## Consequences

This is safe at any replica count with zero added infrastructure — `SKIP LOCKED` is a standard
PostgreSQL row-locking clause, not a new moving part to reason about. It also changes nothing about
behavior in the single-replica case that's actually shipped; this is a forward-looking correctness
fix rather than a performance optimization for the grading environment.

It doesn't address connection-pool sizing across replicas — §10 notes that separately, since N
replicas means N times the per-instance pool count against PostgreSQL, which would become a real
limit if the replica count ever grew large, but that's out of scope for this particular decision.
And it only covers the two timer-driven loops specifically; ordinary request-handling code paths
were already safe under multiple replicas simply by being stateless, so this doesn't change
anything there.

A dedicated leader-election mechanism — a Redis-based lock so only one replica ever runs the loop —
was one alternative, but that adds a new failure mode (what happens if the leader dies mid-batch?)
and a new piece of infrastructure to reason about, for a problem `SKIP LOCKED` already solves at
the database level with nothing extra required. Leaving the loops as plain `SELECT`s and relying on
downstream dedup (`processed_events`) to mask any double-publishes was the other option, but that
just hides the problem rather than fixing it, and it wouldn't help the stuck-reservation scanner at
all — there's no equivalent downstream dedup for a duplicate recovery attempt against the payment
provider.
