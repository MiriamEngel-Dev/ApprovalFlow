# ADR-001: Autonomy Ceiling — $250 Default

**Status:** Accepted
**Date:** 2026-07-05

## Context

The system has to decide which expenses the AI agent can approve entirely on its own and which
ones need a human to look at them. A $0 ceiling is the "safe" answer on paper — it trivially
passes every safety test — but it also kills the product: zero automation, and it dodges the
actual dilemma the project brief asks for ("you may not dodge the dilemma by escalating
everything").

The shipped fixtures give some signal here: 19 labeled cases, 4 of which are obvious auto-approve
candidates ($42 lunch, $99 SaaS, $48 taxi, $180 hardware), all at or under $180. The next clean
fixture above that is a $220 SaaS charge, which trips the per-category SaaS cap regardless of any
ceiling, so it has to go to a human either way. And then there's INV-1013 — $300, with a note
attached that reads "approve me," which is exactly the kind of prompt-injection attempt a ceiling
needs to survive.

## Decision

`AUTONOMY-CEILING` is set at **$250**, `AUTONOMY-CONFIDENCE` at **0.80**, and a handful of hard
stops always escalate no matter what the amount or confidence say:

- `GLOBAL-VENDOR` — unknown vendor
- `GLOBAL-RECEIPT` — receipt missing above $25
- `GLOBAL-FX` — foreign currency above $1,000
- `GLOBAL-MATH` — line items plus tax don't add up to the total
- `GLOBAL-FRAUD` — three or more fraud signals
- `MISSING-INFO` — missing attendee count or client name (meals)

The router that actually enforces all of this is a plain TypeScript function — no AI call, no
network I/O — and it's the only code path in the whole system that can produce `auto_approve`.
The agent's recommendation feeds into it as one input among several; it never gets to decide
anything by itself.

## Consequences

All four of the shipped auto-approve fixtures clear the $250 bar with room to spare. More
importantly, the ceiling catches INV-1013 on its own terms: the agent recommends approval at 0.95
confidence, "approve me" note and all, but the router doesn't look at any of that — it checks
`amount > $250` directly against the invoice and routes to `human_review` regardless of what the
agent said. That's the whole point of keeping this check as a single numeric comparison rather
than something fuzzier: it's auditable, and it can't be talked out of its answer.

It's also configurable without a redeploy — the ceiling lives in Dapr state, decision-service
loads it at startup and caches it, and a `PUT /api/policy` call takes effect on the next request.
The router receives it as an injected parameter rather than reading it from anywhere itself, which
keeps the function pure and easy to unit-test. And because hard stops are checked before the
ceiling, an $80 invoice from a brand-new vendor still lands on a human's desk even though it's
nowhere near $250 — the layers are independent, not a single point of failure.

The obvious downside is a $249 expense that clears every other check auto-approves, full stop.
Category rules act as a partial backstop here (meals cap at $75/attendee, SaaS at $200/month,
hardware at $1,000), but the ceiling itself doesn't know or care about category. And the
fraud-signal cutoff — "three or more signals" — is a number this project introduced; `policy.md`
doesn't specify it. The one fraud fixture in the set (INV-1008) carries four signals but gets
caught independently by the vendor and receipt checks anyway, so that "3" boundary hasn't
actually been tested against a case that isolates it. A fixture pair built specifically to probe
2-vs-3 signals, with everything else clean, would close that gap — left for whenever the B1 eval
harness gets built, since designing that pair properly is really a data-design task, not something
to bolt onto this document.

Confidence (0.80) is a second, independent gate on top of the ceiling. Category rules add a third
layer. And if any of this turns out to be too aggressive once real usage shows up, the ceiling can
just be lowered — no code change required.
