# ADR-002: Dapr as Service Mesh vs Direct HTTP Calls

**Status:** Accepted
**Date:** 2026-07-05

## Context

The system has 4 microservices that must communicate. Two approaches:

1. **Direct HTTP calls** — each service calls others directly. Simple implementation,
   zero additional infrastructure. But: no built-in observability, no retry/circuit-breaker,
   no mTLS, manual service discovery.

2. **Dapr service mesh** — each service gets a sidecar container. Services communicate
   through the sidecar, which handles mTLS, retries, circuit-breaking, tracing, and
   service discovery. Requires running one sidecar per service.

## Decision

Use **Dapr as the service mesh** for all inter-service communication — both synchronous
(service invocation) and asynchronous (pub/sub over Redis). Use the **HTTP API directly**
(`fetch` to `localhost:3500`), not the JavaScript SDK — avoiding dependency risk.

Building blocks used:
- **Service Invocation** — sync calls (gateway→services, decision→payment saga trigger)
- **Pub/Sub** (Redis) — 11 topics, at-least-once delivery
- **State Store** (Redis) — idempotency keys, processed event cache, budget locks, policy cache
- **Secrets** (local file) — LLM API key, JWT signing key
- **Configuration** — hot-reloaded policy thresholds
- **Resiliency** — timeouts (10s–30s), retries (3×, scoped to 5xx/429/connection failures only —
  no circuit breaker; see ARCHITECTURE.md §10 for why Dapr's can't safely sit on top of an API
  that returns ordinary 4xx responses)

## Consequences

**Positive:**
- **mTLS** — all service-to-service traffic is encrypted without application code changes.
- **Resiliency** — per-path timeout and retry declared in YAML, not code.
- **Observability** — Dapr emits trace spans for every invocation. Correlation IDs
  propagate via CloudEvents.
- **Service discovery** — Dapr sidecars handle it; apps only know app-ids
  (`decision-service`), not IPs or ports.
- **Pub/sub abstraction** — apps publish to topic names, not Redis channels. Subscriber
  dedup via CloudEvent `id` field.
- **Secrets** — API keys never in code or env vars.
- **Portability** — moving from Redis to Kafka for pub/sub changes only the Dapr
  component YAML, not application code.

**Negative:**
- 4 additional containers (one sidecar per service) — adds ~200 MB RAM.
- Sidecar startup adds ~2 seconds to service initialization.
- Debugging requires tracing through an additional layer (app → sidecar → sidecar → app).

**Alternatives considered:**
- Direct HTTP calls with manual retry/circuit-breaker libraries: more code, less
  consistency, no built-in mTLS or tracing.
- gRPC directly: better performance but no pub/sub abstraction, no secrets, no state
  store — each would need separate integration.
- Using the Dapr JavaScript SDK: abandoned due to dependency risk and version mismatch
  concerns — the HTTP API is stable and portable.
