# ADR-009: Database-per-service over shared database

**Context:** The four services all need persistent storage. A single shared PostgreSQL database
would make cross-service queries and transactions trivial, but it also couples the services
together in exactly the way a microservice architecture is supposed to avoid. Fully separate
databases per service give real isolation but add operational weight.

**Decision:** One shared PostgreSQL instance, but a separate logical database per service —
`submission_db`, `decision_db`, `payment_db`, `audit_db` — with no cross-database queries and no
foreign keys between them.

**Rationale:** This satisfies both M3 (real microservices) and M4 (one `docker compose up`) at the
same time — a single PostgreSQL container running four databases is operationally simple while
still being logically separated. There are no cross-service foreign key constraints; referential
integrity that spans services is enforced at the application layer instead — decision-service, for
instance, validates a `submission_id` by fetching it from submission-service rather than trusting a
database-level FK that shouldn't exist across a service boundary anyway. Each service's schema can
also evolve on its own timeline with no migration coordination needed, and the audit database sits
physically apart from the operational ones, so auditors can query it without touching anything that
affects live traffic.

A single shared database was the obvious alternative — simpler migrations, and cross-service joins
and transactions become trivial — but that's exactly the coupling this design is trying to avoid: a
schema change in one service could break another, and shared transactions make it easy to build
cross-service consistency that would never survive an actual service split. Fully separate
PostgreSQL containers per service would give maximum isolation, but four PostgreSQL containers in
Docker Compose is heavier than it needs to be, and the priority here (per M4) is a smooth dev/test
experience.

**Consequences:** Only one PostgreSQL container to manage, real logical separation so no service
can accidentally reach into another's tables, and a physically separate audit database for
compliance purposes. The tradeoff is that referential integrity across services can't be enforced
at the database level — that's by design, not an oversight — and the init script has to set up all
four databases.
