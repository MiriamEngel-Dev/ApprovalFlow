# ADR-012: Policy snapshot per decision — closing the F9/F10 proof gap

**Status:** Draft — needs your own review before defending this
**Date:** 2026-07-06

## Context

M13/F7 require the autonomy ceiling and policy thresholds to be changeable at runtime via
`PUT /api/policy`, without a redeploy. But F9 requires a complete decision trail ("rules
applied") and F10 requires proving the system never auto-approved above the *configured* limit.
Tracking only `policy:latest` (today's value) cannot answer "what ceiling applied to *this*
decision" once an admin has since changed it — an auditor re-running F10's proof against current
config would silently check the wrong numbers for any decision made under a prior configuration.

## Decision

Every row in `decisions` (§8) carries a `policy_snapshot JSONB` column: the `{ceiling,
confidence_threshold, policy_version}` values decision-service actually had cached at the moment
the router ran for that row, written in the same INSERT as the rest of the row. `policy_version`
is a monotonic integer bumped on every successful `PUT /api/policy`, so two decisions with
identical threshold values can still be distinguished if a controller made a no-op change.
`GET /api/audit/:submissionId` returns this snapshot alongside every decision version.

## Consequences

**Positive:**
- F9/F10 are checked against the configuration actually in force at decision time, not whatever
  `policy:latest` holds when the audit query runs later.
- No extra table or join — the snapshot lives on the row it describes, consistent with F9's
  "linked by one correlation id."

**Negative:**
- Denormalized: the same threshold values get repeated across every decision row instead of
  living in one place. Accepted because the audit trail's job is to answer "what applied to this
  row," not to be a normalized policy history.
- Doesn't retroactively fix decisions made before this column existed (none exist yet — the
  system is pre-implementation).

**Alternatives considered:**
- A separate `policy_versions` history table with a foreign key from `decisions`: rejected for
  now — adds a join for every audit read, for a benefit (a queryable global policy history) that
  neither F9 nor F10 actually asks for; F9/F10 only need "what applied to this decision," which
  the embedded snapshot already answers.
- Relying on structured logs alone (log the ceiling on every decision, reconstruct from log
  aggregation): rejected — logs are not the audit system of record here (`decisions`/`audit_events`
  are, per F9), and log retention/rotation would make this an unreliable long-term proof.
