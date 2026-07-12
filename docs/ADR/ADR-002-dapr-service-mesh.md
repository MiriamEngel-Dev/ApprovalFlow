# ADR-002: Dapr as Service Mesh vs Direct HTTP Calls

**Status:** Accepted
**Date:** 2026-07-05

## Context

The four microservices need a way to talk to each other. The simplest option is direct HTTP calls
— zero extra infrastructure, easy to reason about — but it also means building retries, circuit
breaking, mTLS, and service discovery by hand, or doing without them. The alternative is Dapr: give
every service a sidecar container, and let the sidecar handle encryption, retries, tracing, and
discovery, at the cost of running one extra container per service.

## Decision

Dapr handles all inter-service communication — synchronous service invocation and async pub/sub
over Redis alike. It's used through the plain HTTP API (`fetch` calls to `localhost:3500`) rather
than the official JS SDK, mainly to avoid pulling in an extra dependency that would need to track
Dapr's own version.

The building blocks in use: service invocation for synchronous calls (gateway to the services,
decision-service kicking off the payment saga), pub/sub over Redis across eleven topics with
at-least-once delivery, the state store (also Redis) for idempotency keys, processed-event
caching, budget locks, and the policy cache, a local-file secrets store for the LLM API key and
JWT signing key, hot-reloadable configuration for policy thresholds, and resiliency policies —
timeouts between 10 and 30 seconds, three retries scoped to 5xx/429/connection failures only. No
circuit breaker sits on top of any of this; see ARCHITECTURE.md §10 for why Dapr's circuit breaker
can't safely coexist with an API that returns ordinary 4xx responses as part of normal operation.

## Consequences

The upside is real: every service-to-service call gets mTLS without a line of application code,
timeout and retry behavior lives in YAML instead of being hand-rolled per call site, and Dapr
emits trace spans for every invocation with correlation IDs propagating automatically through
CloudEvents. Services only need to know each other's app-ids, not IPs or ports, and pub/sub
publishers just write to a topic name rather than talking to Redis channels directly — subscriber
dedup comes for free via the CloudEvent `id` field. Secrets never touch application code or env
vars. And if Redis ever needed to be swapped for Kafka, that would be a change to a Dapr component
YAML file, not to any service's code.

The cost is four extra containers — one sidecar per service, roughly 200MB of RAM — plus a couple
of seconds added to service startup while the sidecar comes up, and one more layer to trace through
when debugging (app → sidecar → sidecar → app).

Direct HTTP calls with hand-rolled retry/circuit-breaker libraries were the obvious alternative,
but that's more code with less consistency across services and no built-in mTLS or tracing. gRPC
was also on the table — better raw performance, but no pub/sub abstraction, no secrets store, no
state store, so each of those would need its own separate integration. The Dapr JS SDK itself was
ruled out early over dependency risk and version-mismatch concerns; the HTTP API is stable and
doesn't tie the codebase to a client library's release cadence.
