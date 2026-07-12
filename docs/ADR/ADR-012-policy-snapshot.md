# ADR-012: Policy snapshot per decision — closing the F9/F10 proof gap

**Status:** Accepted
**Date:** 2026-07-06

## Context

M13/F7 require the autonomy ceiling and policy thresholds to be changeable at runtime through
`PUT /api/policy`, without a redeploy. But F9 requires a complete decision trail — "rules applied"
— and F10 requires being able to prove the system never auto-approved above whatever limit was
actually configured at the time. If only `policy:latest` is tracked, there's no way to answer "what
ceiling applied to this particular decision" once an admin has changed it since — re-running F10's
proof against today's config would silently check the wrong numbers for any decision made under an
earlier configuration.

## Decision

Every row in `decisions` (§8) carries a `policy_snapshot JSONB` column: the exact `{ceiling,
confidence_threshold, policy_version}` values decision-service had cached at the moment the router
ran for that row, written in the same INSERT as everything else. `policy_version` is a monotonic
integer bumped on every successful `PUT /api/policy`, so even two decisions with identical
threshold values can still be told apart if an admin made a no-op change in between.
`GET /api/audit/:submissionId` returns this snapshot alongside every decision version.

## Consequences

F9 and F10 can now be checked against whatever configuration was actually in force at decision
time, not whatever `policy:latest` happens to hold when someone runs the audit query later. There's
no extra table or join needed either — the snapshot lives directly on the row it describes, which
fits F9's "linked by one correlation id" requirement naturally.

The tradeoff is real denormalization: the same threshold values get repeated across every decision
row instead of living in one place. That's acceptable here because the audit trail's job is to
answer "what applied to this row," not to serve as a normalized history of policy changes. It also
doesn't retroactively fix any decisions made before this column existed — though none exist yet,
since the system is still pre-implementation at this point.

A separate `policy_versions` history table with a foreign key from `decisions` was one alternative,
but that adds a join to every audit read for a benefit — a queryable global policy history — that
neither F9 nor F10 actually asks for; both only need "what applied to this decision," which the
embedded snapshot already answers directly. Relying on structured logs instead — logging the
ceiling on every decision and reconstructing history from log aggregation — was the other
alternative, and it doesn't hold up either: logs aren't the system of record here, `decisions` and
`audit_events` are (per F9), and log retention and rotation would make this an unreliable long-term
proof.
