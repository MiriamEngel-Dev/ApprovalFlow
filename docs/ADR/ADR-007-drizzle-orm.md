# ADR-007: Drizzle ORM over Prisma / TypeORM

**Context:** Each of the four services needs its own PostgreSQL schema, migrations, and type-safe
query building. Which ORM I picked was going to affect day-to-day developer experience, how
migrations are handled, and runtime performance.

**Decision:** Drizzle.

**Rationale:** Drizzle schemas map 1:1 to actual SQL tables — no implicit joins, no hidden
behavior, nothing surprising happening behind the scenes. There's no query-engine binary to load
(unlike Prisma, which ships a separate Rust binary) and no proxy objects at runtime, so it stays
light. Column types come straight from PostgreSQL rather than being inferred generically, migration
generation and a programmatic migration runner are both built in (`drizzle-kit generate` /
`migrate`), and the whole thing is lightweight enough to not add meaningfully to a Docker Compose
setup that's already running a sidecar per service.

Prisma has good developer ergonomics, but that Rust query-engine binary adds real startup latency,
and the generated client is fairly opaque once something goes wrong. Its schema-first approach also
doesn't compose especially well with TypeScript union types, which the saga states here rely on
directly. TypeORM is full-featured but heavy, mixes Active Record and Data Mapper patterns in a way
that adds complexity without much benefit here, and its auto-sync migration support is fragile
enough that I didn't want to depend on it.

**Consequences:** Startup is fast and the footprint stays small, which matters with 12+ containers
already running. Queries are type-safe without a code-generation step in the way. The tradeoffs are
a smaller community than Prisma — fewer examples and plugins to lean on — and the need to drop into
raw SQL (via Drizzle's `sql` template tag) for anything more complex, like `SELECT ... FOR UPDATE`.
