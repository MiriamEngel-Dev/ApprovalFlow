# ADR-011: decision-service scope — considered-and-rejected assessment/workflow split

**Status:** Accepted
**Date:** 2026-07-06

## Context

decision-service currently bundles four things together: hard-stop and rule checks, the LLM agent
call, the deterministic router that enforces the autonomy ceiling, and management of the
human-review queue, including re-assessment when a submission is supplemented. M3 asks for at
least three microservices and is graded specifically on IDesign-style volatility-based
decomposition — split by independent reason to change, not by CRUD entity. There's a real argument
that the LLM/RAG side of things could change on a different cadence than the router or threshold
tuning, which is a genuine, independent volatility reason, so I considered splitting
decision-service into an `assessment-service` (LLM and RAG only) and a `workflow-service` (router,
ceiling, HITL queue).

## Decision

I rejected the split. decision-service stays as one service, owning hard-stops, the agent call,
the router, and the HITL queue together.

## Consequences

The router's provability doesn't come from being in its own process — it comes from pure-function
unit tests and the CI eval harness. Moving it into a second container would add a network hop
between "the agent recommends" and "the router decides" without making that guarantee any
stronger; it's optics, not actual safety. That separation is already fully enforced in-process
today, since the router is the only code path in the system that can produce `auto_approve` (see
§5 of ARCHITECTURE.md). Splitting it out would also add a synchronous hop right in the tightest
latency path in the system — the LLM call already carries something like a 30-second timeout
budget on its own — plus a second correlation-id and resiliency surface to reason about, for a
capstone that's graded on having at least three well-bounded services, not on having as many as
possible. And it would push the container count from 12 to 14 (five services × two for app plus
sidecar, plus nginx, Redis, PostgreSQL, and the UI) for a setup that's meant to run with one
`docker compose up` on a single dev machine, with nothing gained from the rubric's perspective in
exchange.

Keeping it merged means one volatility area — the whole policy-decisioning workflow — stays as one
service: hard-stops, the agent call, the router, and the queue all change together whenever
`PUT /api/policy` changes a threshold, which is consistent with the reasoning in §1's "Why These
Boundaries" section. It also keeps correlation-id propagation simpler and cuts down on how many
Dapr resiliency policies need maintaining. If the LLM/RAG layer's release cadence ever genuinely
diverges from the router's — say, swapping providers weekly while the ceiling only changes
quarterly — this decision is worth revisiting, which is exactly why it's written down here rather
than left as an unrecorded judgment call.

The other option on the table was merging decision-service into payment-service instead, making one
combined "workflow" service. That's worse, not better — payment's saga and compensation logic is
its own financial-consistency volatility domain, entirely disjoint from policy decisioning, and
merging the two would blur exactly the kind of boundary IDesign penalizes most: one drawn for
convenience rather than around a real reason to change.
