# ADR-007: Drizzle ORM over Prisma / TypeORM

**Context:** Four services each need their own PostgreSQL schema, migrations, and
type-safe query building. ORM choice affects developer experience, migration strategy,
and runtime performance.

**Decision:** Drizzle ORM.

**Rationale:**
- SQL-first: Drizzle schemas map 1:1 to SQL tables — no implicit behavior, no hidden
  joins, no N+1 surprises
- Zero runtime overhead: no query engine binary (unlike Prisma), no proxy objects
- TypeScript-native: column types inferred from PostgreSQL types, not generic
- Built-in migration generation (`drizzle-kit generate`) + programmatic migration runner
  (`drizzle-kit migrate`)
- Lightweight enough for a sidecar-heavy Docker Compose environment (each service already
  shares memory with Dapr)

**Alternatives considered:**
- Prisma: Good DX, but requires a Rust query engine binary (~15MB), adds startup latency,
  and the generated client is opaque. Schema-first approach doesn't compose well with
  TypeScript union types for saga states.
- TypeORM: Full-featured but heavy; Active Record and Data Mapper patterns add complexity;
  migration support is fragile with auto-sync.

**Consequences:**
- ✅ Fast startup, small footprint — important for Docker Compose with 12+ containers
- ✅ Type-safe queries with no code generation step
- ⚠️ Smaller community than Prisma — fewer examples, plugins
- ⚠️ Raw SQL needed for complex queries (e.g., `SELECT ... FOR UPDATE`); Drizzle supports
  this via `sql` template tag
