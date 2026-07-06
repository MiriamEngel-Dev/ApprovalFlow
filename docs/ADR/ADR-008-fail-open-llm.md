# ADR-008: Fail-open for AI provider errors

**Context:** The LLM provider (Gemini free tier) may return errors: rate limits (429),
timeouts, malformed responses, or 5xx. The system must handle these without data loss
or incorrect auto-approvals.

**Decision:** **Fail open** — any LLM error or timeout sets `confidence=0` and the
deterministic router routes to `human_review`.

**Rationale:**
- Conservative by default: when the agent can't analyze, a human must decide. This
  never auto-approves a risky item.
- No submissions are rejected or dropped — the system remains available, just with
  increased human workload during provider outages.
- The router's ceiling and hard stops are independent of the agent — even if the
  fallback path somehow produced `auto_approve` (it can't), the router would still
  check the ceiling.

**Alternatives considered:**
- Fail-closed (503 all submissions): System is unavailable. Rejected because submission
  must be non-blocking (F1).
- Retry with exponential backoff only: Adds latency; a prolonged outage would queue
  submissions indefinitely. Rejected because a human can decide faster.

**Consequences:**
- ✅ System remains available during provider outages
- ✅ Zero risk of auto-approving during provider errors
- ⚠️ Human queue grows during outages — need monitoring on escalation rate
- ⚠️ A sustained outage could overwhelm approvers — mitigated by the `AUTONOMY-CEILING`
  limiting damage per item to $250
