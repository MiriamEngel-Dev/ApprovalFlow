# ADR-015: Self-signed JWT roles instead of a real identity provider

**Status:** Accepted
**Date:** 2026-07-12

## Context

N1 asks for AuthN/AuthZ with roles (submitter/approver/admin), and explicitly allows a
self-signed JWT as sufficient — this isn't a project about building or integrating an identity
system, it's a project about the approval workflow, the router, and the payment saga. A real
identity provider (Auth0, Cognito, Keycloak, or even a hand-rolled username/password system with
a real user table and hashed credentials) was the alternative worth naming, since it's what a
production system would actually need.

## Decision

`POST /api/auth/login` takes a `{ name, role }` body with no password and no credential check at
all, and mints a JWT signed with a key from the local Dapr secret store
(`shared/src/auth.ts`'s `mintToken`). Every other service verifies the signature and reads the
role claim to enforce `requireRole(...)` on its own routes — the trust boundary is "holds a
validly-signed token," not "has proven who they are." There is no user table anywhere in the
system; `sub` is whatever string the caller supplied at login.

## Consequences

This satisfies exactly what N1 asks for — real role-gated authorization, `403` on a
wrong-role request, `401` on a missing/invalid token — while keeping the entire auth surface to
one small file (`shared/src/auth.ts`) instead of an identity-provider integration that this
project's actual grading criteria (the four journeys, the router, the saga) don't touch. It also
keeps the system runnable with zero external accounts or paid services, consistent with the
project's own "runs free and local" constraint.

The real cost is that "login" proves nothing — anyone can mint an `admin` token for any name by
simply asking for one. That's a correctness gap for a real product, not a demo one: `PUT
/api/policy` (admin-only) is reachable by whoever chooses to claim the admin role at login. This
is an accepted, explicit limitation of the posture N1 allows, not an oversight — the UI's login
screen exists deliberately to mint a token for whatever name+role the user selects, not to
authenticate them (see `Submit.tsx`'s Submitter field, which is derived from this same claim
precisely because it's treated as a trusted identity within the system's own boundary, even though
nothing outside that boundary vouches for it).

**Alternatives considered:** A real username/password table with hashed credentials was
considered and rejected — it would add a genuine security surface (password storage, reset flows,
brute-force protection) to defend for a capstone whose grading rubric doesn't ask for it, without
making any of the four required journeys more correct. An external identity provider (Auth0,
Cognito) was also considered and rejected for the same reason, plus it would violate the "runs
free and local, no paid services" constraint the project operates under.
