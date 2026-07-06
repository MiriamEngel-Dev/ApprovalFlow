# ADR-011: decision-service scope — considered-and-rejected assessment/workflow split

**Status:** Accepted
**Date:** 2026-07-06

## Context

`decision-service` currently bundles four things: hard-stop/rule checks, the LLM agent call
(assessment), the deterministic router (M12's autonomy-ceiling enforcement), and HITL
approval-queue management (including re-assessment on supplement). M3 requires "at least 3
microservices" and is graded specifically on IDesign-style volatility-based decomposition —
decompose by *independent reason to change*, not by CRUD/entity. The LLM/RAG-tuning cadence
*can* diverge from router/threshold-tuning cadence — a real, independent volatility reason — so
splitting `decision-service` into an `assessment-service` (LLM + RAG only) and a
`workflow-service` (router + ceiling + HITL queue) was considered.

## Decision

**Reject the split.** Keep `decision-service` as a single service owning hard-stops, the agent
call, the router, and the HITL queue.

## Consequences

**Why rejected:**
1. The router's provability (M12/F10) rests on **pure-function unit tests + the CI eval
   harness**, not on a process boundary. Moving the router to a second container adds a network
   hop between "agent recommends" and "router decides" without strengthening the guarantee at
   all — it's optics, not safety. The "agent recommends, router decides" separation is already
   fully enforced in-process (the router is the only code path producing `auto_approve`; see §5).
2. It would add a synchronous hop inside the tightest latency path in the system — the LLM call
   already carries a ~30s timeout budget (§7) — plus a second correlationId/circuit-breaker
   surface to reason about, for a capstone graded on "≥3 services, correct boundaries." M3 sets
   no upper target; more services is not inherently worth more.
3. It would raise the footprint from 12 to 14 containers (5 services × 2 [app+sidecar] + nginx +
   Redis + PostgreSQL + UI) for a single-dev-machine `docker compose up`, with no corresponding
   rubric benefit.

**Positive (of keeping it merged):**
- One volatility area (the policy-decisioning workflow) stays as one service — hard-stops, the
  agent call, the router, and the queue all change together whenever a policy or threshold
  changes (`PUT /api/policy`), consistent with §1's "Why These Boundaries."
- Simpler correlationId propagation and fewer Dapr resiliency policies to maintain.

**Negative:**
- If the LLM/RAG layer's release cadence genuinely diverges from the router's in a future
  iteration (e.g., swapping providers weekly while the ceiling changes quarterly), this decision
  should be revisited — recorded here so the reasoning isn't silently lost.

**Alternatives considered:**
- Split into `assessment-service` + `workflow-service`: rejected per the three points above.
- Merge `decision-service` into `payment-service` (single "workflow" service): rejected —
  payment's saga/compensation logic is a distinct financial-consistency volatility domain,
  disjoint from policy decisioning; merging would blur the boundary IDesign penalizes most for
  being drawn along convenience rather than volatility.
