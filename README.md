# ApprovalFlow — Invoice & Expense Approval Platform

> Status: under active development. This README is a scaffold — see
> [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) (Milestone 15) for what's still to be
> filled in.

A microservice-based, AI-assisted platform that automates invoice and expense approvals: an AI
agent assesses each submission against a configurable company policy, a deterministic router
auto-approves the low-risk majority within a provable ceiling, and escalates everything else to a
human approver. Every decision is fully auditable.

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technologies used](#technologies-used)
- [Running locally](#running-locally)
- [Testing & verification](#testing--verification)
- [Documentation](#documentation)

## Overview

TODO (Milestone 15): one-paragraph product summary, the autonomy dilemma and chosen posture
(link to [docs/PRODUCT-DILEMMA.md](docs/PRODUCT-DILEMMA.md)).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, sequence diagrams, and payment
saga/compensation flow. Key decisions are recorded as ADRs under [docs/ADR/](docs/ADR/ADR.md).

TODO (Milestone 15): embed/link the top-level system diagram here.

## Technologies used

TODO (Milestone 15): table of runtime/language/framework/db/infra choices (see ARCHITECTURE.md §1).

## Running locally

TODO (Milestone 15):

```bash
cp .env.example .env
docker compose up
```

## Testing & verification

TODO (Milestone 15): `npm test`, `npm run test:integration`, `npm run verify`, `npm run eval`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, diagrams, payment saga
- [docs/PRODUCT-DILEMMA.md](docs/PRODUCT-DILEMMA.md) — the autonomy dilemma and trade-off
- [docs/ADR/ADR.md](docs/ADR/ADR.md) — Architecture Decision Records
- [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) — build sequencing/milestones
- [docs/openapi.yaml](docs/openapi.yaml) — API specification
