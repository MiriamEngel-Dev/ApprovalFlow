# ADR-008: Fail-open for AI provider errors

**Context:** The LLM provider (Gemini's free tier) can fail in the usual ways — rate limits,
timeouts, malformed responses, 5xx errors. Whatever happens, the system can't lose data or, worse,
auto-approve something it never actually evaluated.

**Decision:** Fail open. Any LLM error or timeout sets confidence to 0, and the deterministic
router sends it to `human_review`.

**Rationale:** This keeps the system conservative by default — if the agent can't actually analyze
something, a human decides instead, and nothing gets approved on a technicality. No submission is
ever rejected or dropped because of a provider hiccup either; the system just keeps running, with
more of the load falling on human reviewers during an outage. And this doesn't create any new risk
on the router side — the ceiling and hard stops don't care why confidence is low, so even in the
hypothetical case where the fallback path somehow produced something that looked like
`auto_approve` (which it structurally can't), the router would still apply the same ceiling check
it always does.

Failing closed — returning a 503 to every submission during an outage — was the obvious
alternative, but that makes the whole system unavailable, and submission has to stay non-blocking
regardless of what's happening with the AI provider. Retrying with exponential backoff instead of
falling back to a human was also considered, but that just adds latency, and a long outage would
leave submissions queuing indefinitely — a human can make a call faster than waiting out a
degraded provider.

**Consequences:** The system stays available through provider outages, and there's zero risk of
auto-approving anything during one. The real cost shows up in the human queue, which grows while
the provider is down — worth monitoring the escalation rate for. And a long enough outage could
still overwhelm approvers, though the $250 autonomy ceiling caps how much damage any single item
could have done anyway, which limits how bad things get even in the worst case.
