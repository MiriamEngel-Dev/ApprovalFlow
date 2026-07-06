# ApprovalFlow — Implementation Plan (Zero Code → Passing Must-Haves)

## Context

The repo currently contains only planning artifacts: `ARCHITECTURE.md` (752 lines, fully
designed), 13 ADRs under `docs/ADR/`, `docs/PRODUCT-DILEMMA.md`, and the two fixture files
(`policy.md`, `sample-invoices.json`). **Zero application code exists.** The design work is
thorough and internally consistent — this plan does not redesign anything, it sequences the build
of what's already been decided.

Two ADRs were marked "Draft — needs your own review": **ADR-012** (policy snapshot per decision,
closing the F9/F10 audit-proof gap) and **ADR-013** (`FOR UPDATE SKIP LOCKED` for the outbox relay
and stuck-reservation scanner, for multi-instance safety). Both were reviewed and the reasoning is
sound (standard patterns, no issues found). **Both will be flipped to "Accepted"** (Milestone 15)
and treated as settled for the rest of this plan.

**Deadline: 2026-07-12.** Solo developer. Must-Haves (M3–M18, F1–F10, D1–D7) are mandatory and
graded as pass/fail; Nice-to-Haves (N1–N6) and Bonus (B1) are evaluated as "good/excellent" on top
— not required. Given the timeline, this plan optimizes for **a fully working Must-Have system
with all 4 worked journeys passing**, over partial coverage of everything. The "cut list" at the
end names exactly what gets dropped first if time runs out — never a Must-Have.

Note: only `M3`–`M18` are defined in the docs (no `M1`/`M2`), and only `B1` is defined among Bonus
(no `B2`/`B3` specified) — this plan maps every milestone to the IDs that actually exist.

Git workflow: stay on `core`, one feature branch per milestone below, PR-merge into `core`
(solo GitHub-Flow per D3 — clean history, not review gating). Push to `main` only once all
Must-Haves are green and per the "no further commits to main after 12.07" rule.

---

## Milestone 0 — Repo Hygiene Scaffold & Monorepo Bootstrap

**Build:**
- `.gitignore` (`node_modules`, `dist`, `.env`, `/dapr/secrets.json`, `coverage`, `*.tsbuildinfo`) — keep `eval-results.json` tracked
- `LICENSE` (MIT), `.env.example`, `.nvmrc` (`20`)
- Root `package.json` with npm workspaces (`shared`, `services/*`, `ui`) and scripts: `lint`, `typecheck`, `test`, `test:integration`, `build`, `verify`, `eval`
- `tsconfig.base.json` (strict), `eslint.config.js`, `.prettierrc`
- `README.md` skeleton, `docs/openapi.yaml` skeleton
- `.github/workflows/ci.yml` skeleton (lint + typecheck only for now)
- `dapr/components/` empty dir, `dapr/secrets.json.example`

**Satisfies:** D3, M16/M18/D4/D6 (scaffolds)

**Done:** `npm install` resolves workspaces; `npm run lint`/`typecheck` green (no-op); CI shows green on push.

---

## Milestone 1 — Shared Workspace Package (`@approvalflow/shared`)

**Build** (`shared/`): `types.ts` (Invoice, AgentAssessment, Route, Decision, PolicyConfig, event
payloads for all 11 topics), `dapr-client.ts` (fetch-based `invokeService/publishEvent/saveState/
getState/getSecret` against `localhost:3500`, no SDK — ADR-002), `correlation-id.ts` (Fastify
plugin), `pino-config.ts`, `auth.ts` (JWT verify + role preHandler), `outbox-relay.ts` (**generic**
relay-loop runner reused by submission/decision/payment instead of tripling the same code).

**Satisfies:** M5, M14, N1 (foundation), ADR-005

**Done:** `npm run build -w shared` compiles clean (strict mode); a throwaway consumer test passes.

---

## Milestone 2 — Deterministic Router + Proof Against All 22 Fixtures
*(de-risk immediately, in parallel with Milestone 3 — zero infra dependencies, only needs Milestone 1's types)*

**Build** (`services/decision-service/src/router/`): `router.ts` (pure `route(invoice,
agentAssessment, policyConfig)`, no I/O), `hard-stops.ts`, `category-rules.ts`, `fx.ts`,
`fraud-signals.ts` (ship the documented ≥3-signal default per ADR-001's caveat, don't
over-engineer), `fixture-assessments.ts` (fixture-id → AgentAssessment map — the **single
canonical source** reused later by `StubProvider` and `npm run eval`, build once), `router.test.ts`
(table-driven over all 22 fixtures).

**Satisfies:** M12, F6, F10, ADR-001, ADR-010

**Done:** 22/22 fixtures route correctly. Named assertions: INV-1013 → `human_review` (ceiling
beats 0.95-confidence agent), INV-1011 → `human_review` (hard stop below ceiling), INV-1021 →
`human_review` (TRAVEL-03 fare-class), INV-1020 → `human_review` (confidence gate alone),
INV-1015 → `reject` (alcohol-only). Duplicate (INV-1007) tested as a router unit case with a
mocked flag — the primary duplicate defense is submission-service's DB constraint (Milestone 4).

---

## Milestone 3 — Dapr + Docker Compose Infra Spike
*(the single riskiest unknown — burn down immediately, in parallel with Milestone 2)*

**Build:** `docker-compose.yml` (partial: `postgres`, `redis`, one throwaway `spike` Fastify app +
its Dapr sidecar via `network_mode: "service:spike"`); `dapr/components/{pubsub,statestore,
secrets,resiliency}.yaml` per §7's timeout table (30s LLM / 10s payment saga / 5s ordinary invoke,
3× retry, 5-failure/60s circuit breaker).

**Satisfies:** M4, M5, ADR-002 (proves it, doesn't just assert it)

**Done:** all containers healthy; `curl localhost:3500/v1.0/invoke/spike/method/health` → 200;
state-store roundtrip via Dapr HTTP API; pub/sub roundtrip (spike publishes, a throwaway subscriber
logs receipt). Delete `spike` once proven; keep the component YAMLs and compose patterns as the
template every later service reuses.

**Flag for later:** nginx correlation-ID generation — stock `nginx:alpine` has no UUIDv4 primitive
without `njs`. Resolve in Milestone 11 (recommend `$request_id` as a documented, pragmatic
deviation from strict UUIDv4 formatting).

---

## Milestone 4 — submission-service

**Build** (`services/submission-service/`): schema (`submissions` w/
`UNIQUE(vendor,invoice_number,total)`, `outbox`, `processed_events`); `docker-entrypoint.sh`
running `drizzle-kit migrate`; routes (`POST /api/submissions`, `GET /api/submissions/:id`,
`GET /api/submissions/tracking/:trackingId`, `PATCH /api/invoices/:id/supplement`, `/health`);
`idempotency.ts` (catch UNIQUE violation → `200 {trackingId, status:"duplicate"}` — the F3/
GLOBAL-DUP intake defense, distinct from and simpler than the router's own check);
`outbox-relay.ts` (thin wrapper over shared); `reason-template.ts` (F2 deterministic template).

**Implementation decision to flag:** `GET /api/submissions/:id`'s plain-language reason needs
decision data owned by decision-service. Implement via a sync Dapr invoke to a small internal
endpoint on decision-service (`GET /internal/decisions/by-submission/:id`, added in Milestone 6) —
the most consistent reading of the Communication Map, called out in the PR as an implementation
decision rather than a redesign.

**Satisfies:** F1, F2 (partial), F3, M8, M10, N3 (outbox)

**Done:** unit tests (idempotency, outbox-in-same-tx) green. With just `postgres` up:
`POST localhost:3000/api/submissions` (INV-1001) → `202 {trackingId, correlationId}`; resubmit
identical payload → `200 {trackingId: same, status:"duplicate"}`.

---

## Milestone 5 — Wire submission-service into Compose

**Build:** add `submission-service` + sidecar to `docker-compose.yml` (app-id
`submission-service`, port 3000).

**Done:** direct sidecar invoke succeeds; a throwaway subscriber confirms `InvoiceSubmitted` is
published within ~1s of the INSERT — proves the outbox pattern end-to-end in Compose, not just
unit tests.

---

## Milestone 6 — decision-service

**Build** (`services/decision-service/`, folding in Milestone 2's router): schema (`decisions` w/
`UNIQUE(submission_id,version)` + `policy_snapshot JSONB`, `approval_queue` w/
`UNIQUE(submission_id)`, `outbox`, `processed_events`); `providers/` (`gemini-provider.ts`,
`stub-provider.ts` reusing `fixture-assessments.ts`, switched via `LLM_PROVIDER`; any error →
confidence=0, logged, never swallowed — ADR-008); `policy-cache.ts` (5s TTL over Dapr state,
bumps `policy:version` on `PUT`); `subscribers/invoice-events.ts` (subscribes
InvoiceSubmitted/Supplemented/Resubmitted, dedups via `processed_events`, orchestrates
FX→hard-stops→policy-context→`agent.assess()`→`router.route()`→atomic INSERT+outbox→publish
DecisionMade [+ApprovalTaskCreated]); routes (`GET /api/queue`, `POST /api/approve|reject|
request-info/:queueId` with row-lock resume `SELECT...FOR UPDATE WHERE id=$1 AND
status='pending'` else 409, `GET/PUT /api/policy`, `GET /internal/decisions/by-submission/:id`).

**Flag:** `InvoiceResubmitted`'s exact trigger is underspecified (duplicate path short-circuits
without an event in the sequence diagram) — treat defensively with the same handler as
`InvoiceSubmitted`; none of the 4 required journeys exercise it, don't invent new behavior here.

**Satisfies:** M11, M12, M13, M15, F4, F5, F6, F7, F9, F10, ADR-008, ADR-011, ADR-012

**Done:** router suite still 22/22 + new subscriber/queue/approve tests against real Postgres.
Synthetic `InvoiceSubmitted` for INV-1001 → `decisions.route=auto_approve` with correct
`policy_snapshot`; INV-1003 → `approval_queue` pending; approve → flips to `approved`, publishes
`ApprovalCompleted`; `PUT /api/policy` change reflected within 5s and stamped into the next
decision's snapshot.

---

## Milestone 7 — Wire decision-service into Compose; prove Journeys A & B partially

**Build:** add `decision-service` + sidecar (port 3001) to Compose.

**Done:** Journey A (INV-1001) → `auto_approve` decision (payment gap expected, closed in
Milestone 9). Journey B (INV-1003) → pending → approve → `ApprovalCompleted` published.

---

## Milestone 8 — payment-service

**Build** (`services/payment-service/`): schema (`department_budgets` w/ `UNIQUE(department)` +
`CHECK(reserved+spent<=total)`, `reservations` w/ `UNIQUE(submission_id)`, `payments` w/
`UNIQUE(idempotency_key)`); `seed.ts` (seeds budgets from `sample-invoices.json`'s `budgets`,
no-op if populated); `mock-provider.ts` (deterministic forced-failure hook for Journey D/INV-1012,
not randomness); `saga/{reserve,execute,confirm,compensate}.ts`; `subscribers/decision-made.ts`,
`approval-completed.ts` (**resolve doc ambiguity**: §2 prose calls this "sync fire-and-forget" but
§3's diagram and §6's topic table both model pub/sub — implement pub/sub-triggered, the twice-
stated source wins, call this out in the PR); `scanner/stuck-reservation-scanner.ts` (startup +
30s periodic, `FOR UPDATE SKIP LOCKED` per ADR-013).

**Satisfies:** M9, M10, F3, ADR-003, ADR-004, ADR-013

**Done:** unit tests (saga transitions, compensation-on-decline). Integration: concurrent
INV-1014A+B ($600 each vs $1000 budget) → exactly one reserves+confirms, budget never negative
(proves row-lock). Journey D (INV-1012): forced execute-failure → reservation `compensated`,
budget's `reserved` released.

---

## Milestone 9 — Wire payment-service into Compose; prove Journeys A, B, D end-to-end

**Build:** add `payment-service` + sidecar (port 3002).

**Done:** full submission→decision→payment chain proven for A, B, D via direct invokes/DB queries
(pre-nginx, pre-audit still).

---

## Milestone 10 — audit-service

**Build** (`services/audit-service/`): schema (`audit_events`, `notifications`, plus a
`processed_events`-equivalent for dedup on ingestion — a small necessary addition beyond §8's
literal table list, since audit-service is itself an at-least-once pub/sub subscriber);
`subscribers/catch-all.ts` (all 11 topics); routes (`GET /api/audit/:submissionId`,
`GET /api/dashboard`, `GET /api/notifications/:submissionId`).

**Satisfies:** F4 (rationale visibility), F8, F9, F10, M10

**Done:** add `audit-service` + sidecar (port 3003) to Compose. INV-1001 through the full stack →
≥3 `audit_events` rows queryable by correlationId; dashboard shows non-zero totals; redelivering a
duplicate event doesn't duplicate rows.

---

## Milestone 11 — nginx Gateway + AuthN/AuthZ + Full 12-Container Compose

**Build:** `nginx/nginx.conf` (rate-limit 100/min burst 20 delay 10 → 429, CORS, correlationId via
`$request_id` — documented deviation from strict UUIDv4 — JWT passthrough); `scripts/
generate-jwt.js`; wire `shared/auth.ts` into every route per the role→endpoint table; final
compose with all 12 containers, only `nginx` publishing a host port.

**Satisfies:** M3, M4, M6, N1, N3 (rate limiting)

**Done:** clean-machine `docker compose up` → all 12 containers; unauthenticated `/health` works;
no/garbage JWT → 401; wrong role → 403; burst of requests → 429 after budget.

---

## Milestone 12 — UI

**Build** (`ui/`): `src/api.ts` (fetch wrapper through `:8080`); pages `Submit.tsx` (`/`),
`Status.tsx` (`/status/:trackingId`, polls 5s), `Queue.tsx` (`/queue`, polls 10s),
`Dashboard.tsx` (`/dashboard`). No global state library.

**Satisfies:** M7, plus UI surfaces for F1, F4, F8

**Done:** manual click-through of Journey B in-browser (submit → tracking id → status shows
human_review → queue shows confidence/rules → approve → status flips to payment-succeeded);
dashboard tiles update.

---

## Milestone 13 — CI Pipeline Completion

**Build:** finish `.github/workflows/ci.yml` — lint → typecheck → unit → integration (Postgres/
Redis as GH Actions services, or `docker compose` test profile — decide once, use consistently
locally and in CI) → `docker compose build` → `npm run verify`.

**Satisfies:** M16, M17, N6

**Done:** clean push runs all gates green; a deliberate scratch-branch sabotage (raise ceiling past
$250) fails verify/eval — proves the gate is real, then discard that branch.

---

## Milestone 14 — Verification Command (D5, required) + Eval Harness (B1, bonus)

**Build:** `scripts/verify.ts` (Journeys A/B/C/D + both anti-cheese guards + "≥2 auto-approvals"
check, against a live cluster, `npm run verify`); `scripts/eval.ts` (all 22 fixtures vs
`StubProvider`, accuracy/precision/recall, `eval-results.json` — do only if time remains, but it's
cheap since it mostly reuses Milestone 2's `fixture-assessments.ts`).

**Satisfies:** D5 (required), B1 (bonus)

**Done:** `npm run verify` exits 0, prints PASS for A/B/C/D + guards + auto-approve-count check.

---

## Milestone 15 — README, OpenAPI, Final Docs Pass

**Build:** full `README.md` (overview, diagram, quickstart, verify/eval instructions, env setup,
links to ADRs and PRODUCT-DILEMMA.md); full `docs/openapi.yaml` (every §9 endpoint); **flip
ADR-012 and ADR-013 status from "Draft" to "Accepted"** (one-line edit each — reviewed and
confirmed); final `.env.example`/`LICENSE` review.

**Satisfies:** M18, D2 (status flip), D4, D6

**Done:** fresh clone following README literally reproduces `docker compose up` +
`npm run verify` passing, zero undocumented steps; `docs/openapi.yaml` lints clean.

---

## What to Cut First If Time Runs Short (never a Must-Have)

1. **N5 (RAG over policy)** — cut first. `policy.md` is 76 lines; full-document loading is already
   the documented fallback. Building embeddings for a 76-line doc is novelty, not a functional gap.
2. **N4 (OpenTelemetry)** — cut second. Highest infra cost (Collector+Prometheus+Jaeger+
   instrumentation across 4 services) for a bonus-only line item.
3. **N2 (CD auto-publish)** — cut third. Needs a registry+credentials for a solo capstone.
4. Keep the cheap parts of **N3** (LLM-call semaphore, trivial once decision-service exists); the
   outbox/rate-limit halves are already required side-effects of M10/M6.
5. **N1 (Auth)** — keep unless truly desperate; fully specified and cheap.
6. **B1 (Eval harness)** — cut last among optionals; cheapest bonus to keep once Milestone 2 exists.

## Single Riskiest Technical Unknown

**Dapr sidecar wiring inside Docker Compose.** Nobody has proven `network_mode: "service:{app}"`,
component YAML mounts, or a Redis pub/sub roundtrip work in this repo. Milestone 3 spikes this with
a throwaway service before any real business logic depends on it — cheap to fix on day 1,
catastrophic to discover on day 5.

Secondary risks to decide early rather than scramble late: nginx correlationId without `njs`
(Milestone 3 flag → Milestone 11 resolution, recommend `$request_id`); testcontainers on Windows/
Docker Desktop for integration tests (decide once in Milestone 6 — `testcontainers-node` vs a
plain `docker compose --profile test` pair — and reuse that choice everywhere).

## Critical Files
- `shared/src/dapr-client.ts` — every service's only path to Dapr, get it right once.
- `services/decision-service/src/router/router.ts` — the central-guarantee code path the whole
  "provable ceiling" claim rests on.
- `sample-invoices.json` — ground truth driving router tests, `verify`, and `eval`.
- `docker-compose.yml` — proves M3/M4/M5; built incrementally (Milestones 3/5/7/9/10/11), not in
  one shot.
- `dapr/components/{pubsub,statestore,resiliency}.yaml` — the infra spike's deliverable; every
  later service depends on these being right.

## Verification (end of plan)
Run `docker compose up` from a clean checkout, then `npm run verify` — must print PASS for all
four worked journeys (A: INV-1001 auto-approve, B: INV-1003 escalate-and-resume, C: INV-1007
duplicate short-circuit, D: INV-1012 payment failure+compensation) plus the anti-cheese guards
(INV-1013 does not auto-approve despite "approve me"; INV-1011 escalates despite being under
ceiling; at least 2 fixtures auto-approve with zero human involvement). Additionally: `npm run
lint`, `npm run typecheck`, `npm test`, `npm run test:integration` all green in CI on every push.
